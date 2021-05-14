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
import path from 'path';
import { TransactionStruct } from './transaction';
import { State } from './state';
import { Network } from '../net/network';

export class Blockchain {
  private readonly config: Config;
  private readonly network: Network;
  private readonly publicKey: string;
  private readonly state: State;
  private readonly pathBlockStore: string;
  private mapBlocks: Map<number, BlockStruct> = new Map();
  private mapHashes: Map<number, string> = new Map();
  private latestBlock: BlockStruct = {} as BlockStruct;

  constructor(config: Config, network: Network) {
    this.config = config;
    this.network = network;
    this.publicKey = this.network.getIdentity();
    this.state = new State(this.config, this.network);
    this.pathBlockStore = path.join(this.config.path_blockstore, this.publicKey);
    if (!fs.existsSync(this.pathBlockStore)) {
      fs.mkdirSync(this.pathBlockStore, { mode: '755', recursive: true });
    }
  }

  init() {
    this.state.init();

    try {
      this.read(1);
    } catch (error) {
      this.write(Blockchain.genesis(this.config.path_genesis));
    }

    this.latestBlock = this.read(this.state.getHeight());
    this.populateCache();
  }

  async add(block: BlockStruct): Promise<void> {
    if (!this.verifyBlock(block)) {
      throw new Error(`Blockchain.add(): failed to add block ${block.height} (${block.hash})`);
    }
    this.latestBlock = block;
    this.mapBlocks.set(block.height, block);
    this.mapHashes.set(block.height, block.hash);
    this.write(block);
    if (this.mapBlocks.size > this.config.max_blocks_in_memory) {
      this.mapBlocks.delete(block.height - this.config.max_blocks_in_memory);
      this.mapHashes.delete(block.height - this.config.max_blocks_in_memory);
    }
  }

  get(limit: number = 0, gte: number = 0, lte: number = 0): Array<BlockStruct> {
    limit = Math.floor(limit);
    gte = Math.floor(gte);
    lte = Math.floor(lte);

    // range
    if (gte >= 1 || lte >= 1) {
      gte = gte < 1 ? 1 : gte <= this.state.getHeight() ? gte : this.state.getHeight();
      lte = lte < 1 ? 1 : lte <= this.state.getHeight() ? lte : this.state.getHeight();
      gte = lte - gte > 0 ? gte : lte;
      gte = lte - gte > this.config.max_blocks_in_memory ? lte - this.config.max_blocks_in_memory + 1 : gte;

      return this.getRange(gte, lte);
    }

    return this.getRange(this.state.getHeight() - limit, this.state.getHeight());
  }

  getPage(page: number = 1, size: number = this.config.max_blocks_in_memory): Array<BlockStruct> {
    page = page < 1 ? 1 : Math.floor(page);
    size = size < 1 || size > this.config.max_blocks_in_memory ? this.config.max_blocks_in_memory : Math.floor(size);
    size = size > this.state.getHeight() ? this.state.getHeight() : size;
    const gte = (page - 1) * size <= this.state.getHeight() ? (page - 1) * size + 1 : 1;
    const lte = page * size <= this.state.getHeight() ? page * size : this.state.getHeight();
    return this.getRange(gte, lte);
  }

  getTransaction(origin: string, ident: string): TransactionStruct {
    //@FIXME
    if (origin && ident) {
      return this.latestBlock.tx[0];
    } else {
      return {} as TransactionStruct;
    }
  }

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
  }

  getHeight(): number {
    return this.state.getHeight();
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
        this.state.getHeight() + 1 === block.height &&
        block.previousHash === (this.mapHashes.get(this.state.getHeight()) || '') &&
        block.hash === Blockchain.hashBlock(block) &&
        !Array.from(this.mapHashes.values()).includes(block.hash)
      );
    } catch (error) {
      //@FIXME logging
      Logger.trace(error);
      return false;
    }
  }

  private getRange(gte: number, lte: number): Array<BlockStruct> {
    if (this.mapBlocks.has(gte)) {
      return Array.from(this.mapBlocks.values()).slice(gte, lte);
    }
    return [];
  }

  private populateCache() {
    const l =
      this.state.getHeight() - this.config.max_blocks_in_memory > 0
        ? this.state.getHeight() - this.config.max_blocks_in_memory > 0
        : 1;
    for (let k = this.state.getHeight(); k >= l; k--) {
      const b: BlockStruct = this.read(k);
      this.mapBlocks.set(k, b);
      this.mapHashes.set(k, b.hash);
      this.state.process(b);
    }
  }

  private read(k: number): BlockStruct {
    if (this.mapBlocks.has(k)) {
      return this.mapBlocks.get(k) as BlockStruct;
    }
    const _p = path.join(this.pathBlockStore, String(k).padStart(16, '0'));
    if (!fs.existsSync(_p)) {
      throw new Error('Block not found');
    }
    return JSON.parse(fs.readFileSync(_p).toString());
  }

  private write(block: BlockStruct) {
    const _p = path.join(this.pathBlockStore, String(block.height).padStart(16, '0'));
    fs.writeFileSync(_p, JSON.stringify(block));
    this.state.process(block);
  }
}
