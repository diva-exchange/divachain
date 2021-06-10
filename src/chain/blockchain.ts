/**
 * Copyright (C) 2021 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { BlockStruct } from './block';
import { Util } from './util';
import fs from 'fs';
import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import path from 'path';
import { CommandAddPeer, CommandRemovePeer, CommandModifyStake, TransactionStruct } from './transaction';
import { Server } from '../net/server';
import { NetworkPeer } from '../net/network';

export class Blockchain {
  private readonly server: Server;
  private readonly publicKey: string;
  private readonly dbBlockchain: InstanceType<typeof LevelUp>;
  private readonly dbState: InstanceType<typeof LevelUp>;

  private height: number = 0;
  private mapBlocks: Map<number, BlockStruct> = new Map();
  private mapHashes: Map<number, string> = new Map();
  private latestBlock: BlockStruct = {} as BlockStruct;

  private mapPeer: Map<string, NetworkPeer> = new Map();

  static async make(server: Server): Promise<Blockchain> {
    const b = new Blockchain(server);
    if (server.config.bootstrap) {
      await b.clear();
    } else {
      await b.init();
    }
    return b;
  }

  private constructor(server: Server) {
    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();

    this.dbBlockchain = LevelUp(LevelDown(path.join(this.server.config.path_blockstore, this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });

    this.dbState = LevelUp(LevelDown(path.join(this.server.config.path_state, this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  private async init(): Promise<void> {
    this.height = 0;
    this.mapBlocks = new Map();
    this.mapHashes = new Map();
    this.latestBlock = {} as BlockStruct;

    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createReadStream()
        .on('data', async (data) => {
          const k = Number(data.key);
          const b: BlockStruct = JSON.parse(data.value) as BlockStruct;
          await this.processState(b);

          // cache
          if (b.height + this.server.config.blockchain_max_blocks_in_memory > this.height) {
            this.mapBlocks.set(k, b);
            this.mapHashes.set(k, b.hash);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  async shutdown() {
    await this.dbBlockchain.close();
    await this.dbState.close();
  }

  async clear() {
    await this.dbBlockchain.clear();
    await this.dbState.clear();

    this.height = 0;
    this.mapBlocks = new Map();
    this.mapHashes = new Map();
    this.latestBlock = {} as BlockStruct;
    this.mapPeer = new Map();
  }

  async reset(genesis: BlockStruct) {
    await this.clear();
    this.server.getNetwork().resetNetwork();

    await this.dbBlockchain.put(String(1).padStart(16, '0'), JSON.stringify(genesis));

    await this.init();
  }

  async add(block: BlockStruct): Promise<void> {
    if (!this.verifyBlock(block)) {
      return;
    }

    this.mapBlocks.set(block.height, block);
    this.mapHashes.set(block.height, block.hash);
    await this.dbBlockchain.put(String(block.height).padStart(16, '0'), JSON.stringify(block));
    if (this.mapBlocks.size > this.server.config.blockchain_max_blocks_in_memory) {
      this.mapBlocks.delete(block.height - this.server.config.blockchain_max_blocks_in_memory);
      this.mapHashes.delete(block.height - this.server.config.blockchain_max_blocks_in_memory);
    }

    await this.processState(block);
  }

  async get(limit: number = 0, gte: number = 0, lte: number = 0): Promise<Array<BlockStruct>> {
    limit = Math.floor(limit);
    gte = Math.floor(gte);
    lte = Math.floor(lte);

    // range
    if (gte >= 1 || lte >= 1) {
      gte = gte < 1 ? 1 : gte <= this.height ? gte : this.height;
      lte = lte < 1 ? 1 : lte <= this.height ? lte : this.height;
      gte = lte - gte > 0 ? gte : lte;
      gte =
        lte - gte >= this.server.config.blockchain_max_query_size
          ? lte - this.server.config.blockchain_max_query_size + 1
          : gte;

      const a: Array<BlockStruct> = [];
      return new Promise((resolve, reject) => {
        this.dbBlockchain
          .createValueStream({ gte: String(gte).padStart(16, '0'), lte: String(lte).padStart(16, '0') })
          .on('data', (data) => {
            a.push(JSON.parse(data));
          })
          .on('end', () => {
            resolve(a);
          })
          .on('error', reject);
      });
    }

    // limit
    return new Promise((resolve) => {
      limit =
        limit >= 1
          ? limit > this.server.config.blockchain_max_blocks_in_memory
            ? this.server.config.blockchain_max_blocks_in_memory
            : limit
          : this.server.config.blockchain_max_blocks_in_memory;

      resolve(Array.from(this.mapBlocks.values()).slice(limit * -1));
    });
  }

  async getPage(
    page: number = 1,
    size: number = this.server.config.blockchain_max_blocks_in_memory
  ): Promise<Array<BlockStruct>> {
    page = page < 1 ? 1 : Math.floor(page);
    size =
      size < 1 || size > this.server.config.blockchain_max_blocks_in_memory
        ? this.server.config.blockchain_max_blocks_in_memory
        : Math.floor(size);
    size = size > this.height ? this.height : size;
    const gte = (page - 1) * size <= this.height ? (page - 1) * size + 1 : 1;
    const lte = page * size <= this.height ? page * size : this.height;

    return new Promise((resolve, reject) => {
      const a: Array<BlockStruct> = [];
      this.dbBlockchain
        .createValueStream({ gte: String(gte).padStart(16, '0'), lte: String(lte).padStart(16, '0') })
        .on('data', (data) => {
          a.unshift(JSON.parse(data));
        })
        .on('end', () => {
          resolve(a);
        })
        .on('error', reject);
    });
  }

  async getTransaction(origin: string, ident: string): Promise<TransactionStruct> {
    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createValueStream()
        .on('data', (data) => {
          const b: BlockStruct = JSON.parse(data) as BlockStruct;
          const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
          t && resolve(t);
        })
        .on('end', () => {
          reject(new Error('Not found'));
        })
        .on('error', reject);
    });
  }

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
  }

  getHeight(): number {
    return this.height;
  }

  /**
   * Get the genesis block from disk
   *
   * @param p Path
   */
  static genesis(p: string): BlockStruct {
    if (!fs.existsSync(p)) {
      throw new Error('Genesis Block not found at: ' + p);
    }
    const b: BlockStruct = JSON.parse(fs.readFileSync(p).toString());
    b.hash = Blockchain.hashBlock(b);
    return b;
  }

  private static hashBlock(block: BlockStruct): string {
    const { version, previousHash, height, tx } = block;
    return Util.hash(previousHash + version + height + JSON.stringify(tx));
  }

  private verifyBlock(block: BlockStruct): boolean {
    const arrayOrigin: Array<string> = [];
    for (const t of block.tx) {
      if (
        arrayOrigin.includes(t.origin) ||
        !Util.verifySignature(t.origin, t.sig, t.ident + t.timestamp + JSON.stringify(t.commands))
      ) {
        throw new Error(`Blockchain.add(): failed to add block ${block.height} (${block.hash})`);
      }
      arrayOrigin.push(t.origin);
    }
    return (
      this.height + 1 === block.height &&
      block.previousHash === (this.mapHashes.get(this.height) || '') &&
      block.hash === Blockchain.hashBlock(block) &&
      !Array.from(this.mapHashes.values()).includes(block.hash)
    );
  }

  private async processState(block: BlockStruct) {
    if (this.height < block.height) {
      this.height = block.height;
      this.latestBlock = block;
      await this.dbState.put('height', this.height);
      await this.dbState.put('latestBlock', JSON.stringify(this.latestBlock));
    }

    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case 'testLoad':
            break;
          case 'addPeer':
            await this.addPeer(c as CommandAddPeer);
            break;
          case 'removePeer':
            await this.removePeer(c as CommandRemovePeer);
            break;
          case 'modifyStake':
            await this.modifyStake(c as CommandModifyStake);
            break;
        }
      }
    }
  }

  private async addPeer(command: CommandAddPeer) {
    if (this.mapPeer.has(command.publicKey)) {
      return;
    }

    const peer: NetworkPeer = { host: command.host, port: command.port, stake: command.stake };
    this.mapPeer.set(command.publicKey, peer);
    await this.dbState.put('peer', JSON.stringify(this.mapPeer.keys()));
    this.server.getNetwork().addPeer(command.publicKey, peer);
  }

  private async removePeer(command: CommandRemovePeer) {
    if (this.mapPeer.has(command.publicKey)) {
      this.mapPeer.delete(command.publicKey);
      await this.dbState.put('peer', JSON.stringify(this.mapPeer.keys()));
      this.server.getNetwork().removePeer(command.publicKey);
    }
  }

  private async modifyStake(command: CommandModifyStake) {
    if (this.mapPeer.has(command.publicKey)) {
      const peer: NetworkPeer = this.mapPeer.get(command.publicKey) as NetworkPeer;
      peer.stake = peer.stake + command.stake;
      if (peer.stake < 0) {
        peer.stake = 0;
      }

      this.mapPeer.set(command.publicKey, peer);
      await this.dbState.put('stake:' + command.publicKey, peer.stake);
    }
  }
}
