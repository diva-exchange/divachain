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

import { Config } from '../config';
import { Logger } from '../logger';
import { BlockStruct } from './block';
import { Util } from './util';
import fs from 'fs';
import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import path from 'path';
import { TransactionStruct } from './transaction';
import { State } from './state';
import { Network } from '../net/network';

export class Blockchain {
  private readonly config: Config;
  private readonly network: Network;
  private readonly publicKey: string;
  private readonly state: State;
  private height: number;
  private dbBlockchain: InstanceType<typeof LevelUp>;
  private mapBlocks: Map<number, BlockStruct> = new Map();
  private mapHashes: Map<number, string> = new Map();
  private latestBlock: BlockStruct = {} as BlockStruct;

  constructor(config: Config, network: Network) {
    this.config = config;
    this.network = network;
    this.publicKey = this.network.getIdentity();
    this.height = 1;
    this.state = new State(this.config, this.network);

    this.dbBlockchain = LevelUp(LevelDown(path.join(this.config.path_blockstore, this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  async init(): Promise<void> {
    try {
      await this.dbBlockchain.get(1);
    } catch (error) {
      await this.dbBlockchain.put(1, JSON.stringify(Blockchain.genesis(this.config.path_genesis)));
    }

    await this.state.init();

    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createReadStream({ reverse: true, limit: 1 })
        .on('data', (data) => {
          this.height = Number(data.key);
          this.latestBlock = JSON.parse(data.value) as BlockStruct;
        })
        .on('error', reject);

      this.dbBlockchain
        .createReadStream({ limit: this.config.max_blocks_in_memory })
        .on('data', async (data) => {
          const k = Number(data.key);
          const b: BlockStruct = JSON.parse(data.value) as BlockStruct;
          this.mapBlocks.set(k, b);
          this.mapHashes.set(k, b.hash);
          await this.state.process(b);
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  async shutdown() {
    await this.dbBlockchain.close();
  }

  async add(block: BlockStruct): Promise<void> {
    if (!this.verifyBlock(block)) {
      throw new Error(`Blockchain.add(): failed to add block ${block.hash}`);
    }
    this.height = block.height;
    this.latestBlock = block;
    this.mapBlocks.set(block.height, block);
    this.mapHashes.set(block.height, block.hash);
    await this.dbBlockchain.put(this.height, JSON.stringify(block));
    if (this.mapBlocks.size > this.config.max_blocks_in_memory) {
      this.mapBlocks.delete(this.height - this.config.max_blocks_in_memory);
      this.mapHashes.delete(this.height - this.config.max_blocks_in_memory);
    }

    await this.state.process(block);
  }

  async get(limit: number = 0, gte: number = 0, lte: number = 0): Promise<Array<any>> {
    limit = Math.floor(limit);
    gte = Math.floor(gte);
    lte = Math.floor(lte);

    // range
    if (gte >= 1 || lte >= 1) {
      gte = gte < 1 ? 1 : gte <= this.height ? gte : this.height;
      lte = lte < 1 ? 1 : lte <= this.height ? lte : this.height;
      gte = lte - gte > 0 ? gte : lte;
      gte = lte - gte > this.config.max_blocks_in_memory ? lte - this.config.max_blocks_in_memory + 1 : gte;

      const a: Array<BlockStruct> = [];
      return new Promise((resolve, reject) => {
        this.dbBlockchain
          .createValueStream({ gte: gte, lte: lte })
          .on('data', (data) => {
            a.unshift(JSON.parse(data));
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
          ? limit > this.config.max_blocks_in_memory
            ? this.config.max_blocks_in_memory
            : limit
          : this.config.max_blocks_in_memory;

      resolve([...this.mapBlocks.values()].slice(limit * -1).reverse());
    });
  }

  async getPage(page: number = 1, size: number = this.config.max_blocks_in_memory): Promise<Array<BlockStruct>> {
    page = page < 1 ? 1 : Math.floor(page);
    size = size < 1 || size > this.config.max_blocks_in_memory ? this.config.max_blocks_in_memory : Math.floor(size);
    size = size > this.height ? this.height : size;
    const a: Array<BlockStruct> = [];
    const gte = (page - 1) * size <= this.height ? (page - 1) * size + 1 : 1;
    const lte = page * size <= this.height ? page * size : this.height;

    return new Promise((resolve, reject) => {
      this.dbBlockchain
        .createValueStream({ gte: gte, lte: lte })
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

  getState(): State {
    return this.state;
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
    return JSON.parse(fs.readFileSync(p).toString());
  }

  private static hashBlock(block: BlockStruct): string {
    const { version, previousHash, height, tx } = block;
    return Util.hash(previousHash + version + height + JSON.stringify(tx));
  }

  private verifyBlock(block: BlockStruct): boolean {
    try {
      const arrayOrigin: Array<string> = [];
      for (const t of block.tx) {
        if (
          arrayOrigin.includes(t.origin) ||
          !Util.verifySignature(t.origin, t.sig, t.ident + t.timestamp + JSON.stringify(t.commands))
        ) {
          return false;
        }
        arrayOrigin.push(t.origin);
      }
      return (
        this.height + 1 === block.height &&
        block.previousHash === (this.mapHashes.get(this.height) || '') &&
        block.hash === Blockchain.hashBlock(block) &&
        !Array.from(this.mapHashes.values()).includes(block.hash)
      );
    } catch (error) {
      //@FIXME logging
      Logger.trace(error);
      return false;
    }
  }
}
