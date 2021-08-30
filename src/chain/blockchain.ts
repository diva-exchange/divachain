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
import { Logger } from '../logger';

export class Blockchain {
  private readonly server: Server;
  private readonly publicKey: string;
  private readonly dbBlockchain: InstanceType<typeof LevelUp>;
  private readonly dbState: InstanceType<typeof LevelUp>;

  private hght: number = 0;
  private mapBlocks: Map<number, BlockStruct> = new Map();
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
    this.hght = 0;
    this.mapBlocks = new Map();
    this.latestBlock = {} as BlockStruct;

    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createReadStream()
        .on('data', async (data) => {
          const block: BlockStruct = JSON.parse(data.value) as BlockStruct;
          this.updateCache(block);
          await this.processState(block);
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

    this.hght = 0;
    this.mapBlocks = new Map();
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
    if (
      this.hght + 1 !== block.hght ||
      block.ph !== this.latestBlock.h ||
      block.h !== Blockchain.hashBlock(block)
    ) {
      Logger.warn(
        `Failed to verify block "${block.hght}", ` +
          `Height check: ${this.hght + 1 !== block.hght ? 'failed' : 'ok'}, ` +
          `Previous Hash check: ${block.ph !== this.latestBlock.h ? 'failed' : 'ok'}, ` +
          `Hash check: ${block.h !== Blockchain.hashBlock(block) ? 'failed' : 'ok'}`
      );
      return;
    }

    this.updateCache(block);
    this.server.getNetwork().resetGossip();
    this.server.getCommitPool().clear();
    this.server.getVotePool().clear();
    this.server.getTransactionPool().clear(block);

    await this.dbBlockchain.put(String(this.hght).padStart(16, '0'), JSON.stringify(block));
    await this.processState(block);
  }

  private updateCache(block: BlockStruct) {
    this.hght = block.hght;
    this.latestBlock = block;

    // cache
    this.mapBlocks.set(this.hght, block);
    if (this.mapBlocks.size > this.server.config.blockchain_max_blocks_in_memory) {
      this.mapBlocks.delete(this.hght - this.server.config.blockchain_max_blocks_in_memory);
    }
  }

  //@FIXME the behaviour (either gte and lte OR limit) is crap
  async get(limit: number = 0, gte: number = 0, lte: number = 0): Promise<Array<BlockStruct>> {
    limit = Math.floor(limit);
    gte = Math.floor(gte);
    lte = Math.floor(lte);

    // range
    if (gte >= 1 || lte >= 1) {
      gte = gte < 1 ? 1 : gte <= this.hght ? gte : this.hght;
      lte = lte < 1 ? 1 : lte <= this.hght ? lte : this.hght;
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
    size = size > this.hght ? this.hght : size;
    const lte = this.hght - (page - 1) * size < 1 ? size : this.hght - (page - 1) * size;
    const gte = lte - size + 1;

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

  async getTransaction(origin: string, ident: string): Promise<{ height: number; transaction: TransactionStruct }> {
    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createValueStream()
        .on('data', (data) => {
          const b: BlockStruct = JSON.parse(data) as BlockStruct;
          const t = b.tx.find((t: TransactionStruct) => t.orgn === origin && t.ident === ident);
          t && resolve({ height: b.hght, transaction: t });
        })
        .on('end', () => {
          reject(new Error('Not found'));
        })
        .on('error', reject);
    });
  }

  async getState(key: string = ''): Promise<Array<{ key: string; value: string }>> {
    return new Promise((resolve, reject) => {
      if (!key.length) {
        const a: Array<any> = [];
        this.dbState
          .createReadStream()
          .on('data', (data) => {
            a.push({ key: data.key.toString(), value: data.value.toString() });
          })
          .on('end', () => {
            resolve(a);
          })
          .on('error', (e) => {
            reject(e);
          });
      } else {
        this.dbState.get(key, (error, value: Buffer) => {
          error ? reject(error) : resolve([{ key: key, value: value.toString() }]);
        });
      }
    });
  }

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
  }

  getHeight(): number {
    return this.hght;
  }

  async getPerformance(height: number): Promise<{ timestamp: number }> {
    let ts: number;
    try {
      ts = Number((await this.dbState.get('debug-performance-' + height)).toString());
    } catch (error) {
      ts = 0;
    }
    return { timestamp: ts };
  }

  /**
   * Get the genesis block from disk
   *
   * @param {string} p - Path
   */
  static genesis(p: string): BlockStruct {
    if (!fs.existsSync(p)) {
      throw new Error('Genesis Block not found at: ' + p);
    }
    const b: BlockStruct = JSON.parse(fs.readFileSync(p).toString());
    b.h = Blockchain.hashBlock(b);
    return b;
  }

  private static hashBlock(block: BlockStruct): string {
    const { v, ph, hght, tx } = block;
    return Util.hash(ph + v + hght + JSON.stringify(tx));
  }

  private async processState(block: BlockStruct) {
    if (this.server.config.debug_performance) {
      await this.dbState.put('debug-performance-' + this.hght, new Date().getTime());
    }

    for (const t of block.tx) {
      for (const c of t.cmds) {
        switch (c.cmd) {
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
    if (this.mapPeer.has(command.pk)) {
      return;
    }

    const peer: NetworkPeer = { host: command.host, port: command.port, stake: 0 };
    this.mapPeer.set(command.pk, peer);
    await this.dbState.put('peer:' + command.pk, peer.stake);
    this.server.getNetwork().addPeer(command.pk, peer);
  }

  private async removePeer(command: CommandRemovePeer) {
    if (this.mapPeer.has(command.pk)) {
      this.mapPeer.delete(command.pk);
      await this.dbState.del('peer:' + command.pk);
      this.server.getNetwork().removePeer(command.pk);
    }
  }

  private async modifyStake(command: CommandModifyStake) {
    if (this.mapPeer.has(command.pk)) {
      const peer: NetworkPeer = this.mapPeer.get(command.pk) as NetworkPeer;
      peer.stake = peer.stake + command.stk;
      if (peer.stake < 0) {
        peer.stake = 0;
      }

      this.mapPeer.set(command.pk, peer);
      await this.dbState.put('peer:' + command.pk, peer.stake);
    }
  }
}
