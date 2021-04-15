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
import { Logger } from '../logger';
import { TransactionStruct } from './transaction';

export class Blockchain {
  private readonly publicKey: string;
  private height: number;
  private db: InstanceType<typeof LevelUp>;
  private blocks: Array<BlockStruct> = [];
  private hashes: Array<string> = [];

  constructor(publicKey: string) {
    this.publicKey = publicKey;
    this.height = 1;
    this.blocks.push(Blockchain.genesis());
    this.hashes.push(Blockchain.genesis().hash);

    this.db = LevelUp(LevelDown(path.join(__dirname, '../../blockstore/', this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  async init(): Promise<void> {
    this.db.get(1).catch(() => {
      this.db.put(this.height, JSON.stringify(Blockchain.genesis()));
    });

    return new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', (data) => {
          const k = Number(data.key);
          const b: BlockStruct = JSON.parse(data.value) as BlockStruct;
          this.blocks[k - 1] = b;
          this.hashes[k - 1] = b.hash;
          this.height > k || (this.height = k);
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  async shutdown() {
    await this.db.close();
  }

  isValid(block: BlockStruct): boolean {
    return (
      this.height + 1 === block.height &&
      block.previousHash === this.hashes[this.height - 1] &&
      block.hash === Blockchain.hashBlock(block) &&
      !this.hashes.includes(block.hash) &&
      Blockchain.verifyBlock(block)
    );
  }

  async add(block: BlockStruct): Promise<void> {
    if (!this.isValid(block)) {
      throw new Error(
        `Blockchain.add(): failed to add block ${block.hash}, height ${block.height} === ${this.height + 1} ?`
      );
    }
    this.height = block.height;
    this.blocks.push(block);
    this.hashes.push(block.hash);
    await this.db.put(this.height, JSON.stringify(block));
    //@FIXME logging
    Logger.trace('Block added: ' + block.hash);
  }

  //@FIXME limit: -1, might become a very large array
  async get(limit: number = -1): Promise<Array<BlockStruct>> {
    return new Promise((resolve, reject) => {
      // in memory
      const lmt: number = Number(limit) > 0 ? Number(limit) : -1;
      if (lmt > 0 && this.blocks.length >= lmt) {
        resolve([...this.blocks.slice(lmt * -1)].reverse());
      } else if (lmt === -1 && this.blocks.length === this.height) {
        resolve([...this.blocks].reverse());
      }

      // fallback, read from disk
      const a: Array<BlockStruct> = [];
      this.db
        .createReadStream(lmt > 0 ? { reverse: true, limit: lmt } : {})
        .on('data', (data) => {
          a.push(JSON.parse(data.value) as BlockStruct);
        })
        .on('end', () => {
          resolve(a);
        })
        .on('error', reject);
    });
  }

  async getTransaction(origin: string, ident: string): Promise<TransactionStruct> {
    return new Promise((resolve, reject) => {
      // in memory
      for (const b of this.blocks) {
        const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
        if (t) {
          resolve(t);
        }
      }
      if (this.blocks.length === this.height) {
        reject(new Error('Not found'));
      }

      // fallback, search on disk
      this.db
        .createReadStream()
        .on('data', (data) => {
          const b: BlockStruct = JSON.parse(data.value) as BlockStruct;
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
    return this.blocks[this.height - 1];
  }

  getHeight() {
    return this.height;
  }

  static genesis(): BlockStruct {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/genesis.json')).toString());
  }

  private static hashBlock(block: BlockStruct): string {
    const { version, previousHash, height, tx } = block;
    return Util.hash(previousHash + version + height + JSON.stringify(tx));
  }

  private static verifyBlock(block: BlockStruct): boolean {
    const arrayOrigin: Array<string> = [];
    try {
      for (const t of block.tx) {
        if (arrayOrigin.includes(t.origin)) {
          //@FIXME logging
          Logger.trace(`!! Block invalid: double origin ${t.origin}`);
          return false;
        }
        arrayOrigin.push(t.origin);
        if (!Util.verifySignature(t.origin, t.sig, t.ident + t.timestamp + JSON.stringify(t.commands))) {
          //@FIXME logging
          Logger.trace(`!! Block invalid: invalid signature ${t.origin}`);
          return false;
        }
      }
      return true;
    } catch (error) {
      //@FIXME logging
      Logger.trace(error);
      return false;
    }
  }
}
