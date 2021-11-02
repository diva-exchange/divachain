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

import { Block, BlockStruct } from './block';
import fs from 'fs';
import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import path from 'path';
import {
  CommandAddPeer,
  CommandRemovePeer,
  CommandModifyStake,
  CommandData,
  CommandDecision,
  TransactionStruct,
} from './transaction';
import { Server } from '../net/server';
import { NetworkPeer } from '../net/network';
import { Logger } from '../logger';
import { Validation } from '../net/validation';

export class Blockchain {
  public static readonly COMMAND_ADD_PEER = 'addPeer';
  public static readonly COMMAND_REMOVE_PEER = 'removePeer';
  public static readonly COMMAND_MODIFY_STAKE = 'modifyStake';
  public static readonly COMMAND_DATA = 'data';
  public static readonly COMMAND_DECISION = 'decision';
  public static readonly STATE_DECISION_IDENT = 'decision:';
  public static readonly STATE_PEER_IDENT = 'peer:';
  public static readonly STATE_DECISION_TAKEN = 'taken';

  private readonly server: Server;
  private readonly publicKey: string;
  private readonly dbBlockchain: InstanceType<typeof LevelUp>;
  private readonly dbState: InstanceType<typeof LevelUp>;

  private height: number = 0;
  private mapBlocks: Map<number, BlockStruct> = new Map();
  private latestBlock: BlockStruct = {} as BlockStruct;

  private mapPeer: Map<string, NetworkPeer> = new Map();

  private quorum: number = 0;

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
    this.latestBlock = {} as BlockStruct;
    await this.dbState.clear();

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

    this.height = 0;
    this.mapBlocks = new Map();
    this.latestBlock = {} as BlockStruct;
    this.mapPeer = new Map();
  }

  async reset(genesis: BlockStruct) {
    await this.clear();
    this.server.getNetwork().resetNetwork();
    if (await this.updateBlockData(String(1).padStart(16, '0'), JSON.stringify(genesis))) {
      await this.init();
    }
  }

  add(block: BlockStruct): boolean {
    if (
      this.height + 1 !== block.height ||
      block.previousHash !== this.latestBlock.hash ||
      !Validation.validateBlock(block)
    ) {
      const l: string = `${this.publicKey} - failed to verify block ${block.height}: `;
      if (this.height + 1 !== block.height) {
        Logger.warn(l + '"Height" check failed');
      } else if (block.previousHash !== this.latestBlock.hash) {
        Logger.warn(l + '"Previous Hash" check failed');
      } else {
        Logger.warn(l + '"Validation.validateBlock()" failed');
      }
      return false;
    }

    this.updateCache(block);

    (async () => {
      (await this.updateBlockData(String(block.height).padStart(16, '0'), JSON.stringify(block))) &&
        (await this.processState(block));
    })();

    return true;
  }

  private updateCache(block: BlockStruct) {
    this.height = block.height;
    this.latestBlock = block;

    // cache
    this.mapBlocks.set(this.height, block);
    if (this.mapBlocks.size > this.server.config.blockchain_max_blocks_in_memory) {
      this.mapBlocks.delete(this.height - this.server.config.blockchain_max_blocks_in_memory);
    }
  }

  /**
   * @param {number} gte - Greater than or equal than block height
   * @param {number} lte - Less than or equal than block height
   */
  async getRange(gte: number, lte: number): Promise<Array<BlockStruct>> {
    if (gte < 1) {
      throw new Error('Blockchain.getRange(): invalid range');
    }

    lte = Math.floor(lte < 1 ? this.height : lte);
    gte = gte <= this.height ? Math.floor(gte) : this.height;
    lte = lte <= this.height ? lte : this.height;
    gte = lte - gte > 0 ? gte : lte;
    gte =
      lte - gte >= this.server.config.blockchain_max_query_size
        ? lte - this.server.config.blockchain_max_query_size + 1
        : gte;

    // cache available?
    if (this.mapBlocks.has(gte) && this.mapBlocks.has(lte)) {
      const start = this.mapBlocks.size - this.height + gte - 1;
      const end = start + lte - gte + 1;
      return [...this.mapBlocks.values()].slice(start, end);
    }

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

  async getPage(page: number, size: number): Promise<Array<BlockStruct>> {
    page = page < 1 ? 1 : Math.floor(page);
    size =
      size < 1 || size > this.server.config.blockchain_max_query_size
        ? this.server.config.blockchain_max_query_size
        : Math.floor(size);
    size = size > this.height ? this.height : size;
    const lte = this.height - (page - 1) * size < 1 ? size : this.height - (page - 1) * size;
    const gte = lte - size + 1;

    return this.getRange(gte, lte);
  }

  async getTransaction(origin: string, ident: string): Promise<{ height: number; transaction: TransactionStruct }> {
    return new Promise((resolve, reject) => {
      // cache
      for (const b of [...this.mapBlocks.values()]) {
        const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
        if (t) {
          return resolve({ height: b.height, transaction: t });
        }
      }

      // disk
      this.dbBlockchain
        .createValueStream()
        .on('data', (data) => {
          const b: BlockStruct = JSON.parse(data) as BlockStruct;
          const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
          t && resolve({ height: b.height, transaction: t });
        })
        .on('end', () => {
          reject(new Error('Not found'));
        })
        .on('error', reject);
    });
  }

  async getState(key: string): Promise<Array<{ key: string; value: string }>> {
    return new Promise((resolve, reject) => {
      if (!key.length) {
        const a: Array<any> = [];
        this.dbState
          .createReadStream()
          .on('data', (data) => {
            a.push({ key: data.key.toString(), value: data.value.toString() });
            if (a.length === this.server.config.blockchain_max_query_size) {
              resolve(a);
            }
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
    return this.height;
  }

  getQuorum(): number {
    if (this.quorum <= 0) {
      throw new Error('Invalid network quorum');
    }

    return this.quorum;
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
    b.hash = Block.createHash(b);
    return b;
  }

  private async processState(block: BlockStruct) {
    if (this.server.config.debug_performance) {
      await this.updateStateData('debug-performance-' + this.height, new Date().getTime());
    }

    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case Blockchain.COMMAND_ADD_PEER:
            await this.addPeer(c as CommandAddPeer);
            break;
          case Blockchain.COMMAND_REMOVE_PEER:
            await this.removePeer(c as CommandRemovePeer);
            break;
          case Blockchain.COMMAND_MODIFY_STAKE:
            await this.modifyStake(c as CommandModifyStake);
            break;
          case Blockchain.COMMAND_DATA:
            await this.updateStateData((c as CommandData).ns + ':' + t.origin, (c as CommandData).base64url);
            break;
          case Blockchain.COMMAND_DECISION:
            await this.setDecision((c as CommandDecision).ns, t.origin);
            break;
        }
      }
    }
  }

  private async addPeer(command: CommandAddPeer) {
    if (this.mapPeer.has(command.publicKey)) {
      return;
    }

    const peer: NetworkPeer = { host: command.host, port: command.port, stake: 0 };
    this.mapPeer.set(command.publicKey, peer);
    await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake);
    this.server.getNetwork().addPeer(command.publicKey, peer);
  }

  private async removePeer(command: CommandRemovePeer) {
    if (this.mapPeer.has(command.publicKey)) {
      const peer: NetworkPeer = this.mapPeer.get(command.publicKey) as NetworkPeer;
      this.quorum = this.quorum - peer.stake;

      this.mapPeer.delete(command.publicKey);
      await this.dbState.del(Blockchain.STATE_PEER_IDENT + command.publicKey);
      this.server.getNetwork().removePeer(command.publicKey);
    }
  }

  private async modifyStake(command: CommandModifyStake) {
    if (this.mapPeer.has(command.publicKey)) {
      const peer: NetworkPeer = this.mapPeer.get(command.publicKey) as NetworkPeer;
      if (peer.stake + command.stake < 0) {
        command.stake = -1 * peer.stake;
      }
      this.quorum = this.quorum + command.stake;
      peer.stake = peer.stake + command.stake;

      this.mapPeer.set(command.publicKey, peer);
      await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake);
    }
  }

  private async setDecision(ns: string, origin: string) {
    const key = Blockchain.STATE_DECISION_IDENT + ns;
    let objOriginStake: { [origin: string]: number };
    try {
      const v = (await this.getState(key))[0].value;
      if (v === Blockchain.STATE_DECISION_TAKEN) {
        return;
      }
      objOriginStake = JSON.parse(v);
    } catch (error) {
      objOriginStake = {};
    }
    if (!objOriginStake[origin]) {
      objOriginStake[origin] = this.server.getNetwork().getStake(origin);
      await this.updateStateData(key, JSON.stringify(objOriginStake));
      if (this.getQuorum() <= Object.values(objOriginStake).reduce((a, b) => a + b, 0)) {
        await this.updateStateData(key, Blockchain.STATE_DECISION_TAKEN);
      }
    }
  }

  private async updateBlockData(key: string, value: string | number): Promise<boolean> {
    try {
      await this.dbBlockchain.put(key, value);
      return true;
    } catch (error: any) {
      Logger.warn(JSON.stringify(error));
    }
    return false;
  }

  private async updateStateData(key: string, value: string | number) {
    try {
      await this.dbState.put(key, value);
    } catch (error: any) {
      Logger.warn(JSON.stringify(error));
    }
  }
}
