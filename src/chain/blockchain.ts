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

export class Blockchain {
  private readonly publicKey: string;
  private latestBlock: BlockStruct;
  private height: number;
  private db: InstanceType<typeof LevelUp>;
  private hashes: Array<string> = [];

  constructor(publicKey: string) {
    this.publicKey = publicKey;
    this.height = 1;
    this.latestBlock = Blockchain.genesis();
    this.hashes.push(this.latestBlock.hash);

    this.db = LevelUp(LevelDown(path.join(__dirname, '../../blockstore/', this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  async init(): Promise<void> {
    this.db.get(1).catch(() => {
      this.db.put(this.height, JSON.stringify(this.latestBlock));
    });

    return new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', (data) => {
          if (Number(data.key) > this.height) {
            this.height = Number(data.key);
            this.latestBlock = JSON.parse(data.value) as BlockStruct;
            this.hashes.push(this.latestBlock.hash);
          }
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
      block.previousHash === this.latestBlock.hash &&
      block.hash === Blockchain.hashBlock(block) &&
      Blockchain.verifyBlock(block)
    );
  }

  has(hash: string): boolean {
    return this.hashes.includes(hash);
  }

  add(block: BlockStruct) {
    this.latestBlock = block;
    this.height = block.height;
    this.hashes.push(this.latestBlock.hash);
    this.db.put(block.height, JSON.stringify(block));
  }

  //@FIXME limit: -1, might become a very large array
  async get(limit: number = -1): Promise<Array<BlockStruct>> {
    const a: Map<number, BlockStruct> = new Map();
    const l: number = Number(limit) > 0 ? Number(limit) : -1;
    return new Promise((resolve, reject) => {
      this.db
        .createReadStream(l > 0 ? { reverse: true, limit: l } : {})
        .on('data', (data) => {
          a.set(Number(data.key), JSON.parse(data.value) as BlockStruct);
        })
        .on('end', () => {
          resolve(Array.from(a.values()));
        })
        .on('error', reject);
    });
  }

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
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
    for (const t of block.tx) {
      if (arrayOrigin.includes(t.origin)) {
        //@FIXME logging
        Logger.trace(`!! Block invalid: double origin ${t.origin}`);
        return false;
      }
      arrayOrigin.push(t.origin);
      if (!Util.verifySignature(t.origin, t.sig, JSON.stringify(t.commands))) {
        //@FIXME logging
        Logger.trace(`!! Block invalid: invalid signature ${t.origin}`);
        return false;
      }
    }
    return true;
  }
}
