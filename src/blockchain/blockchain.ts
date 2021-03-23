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
import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import path from 'path';
import { Logger } from '../logger';

export class Blockchain {
  private latestBlock: BlockStruct;
  private height: number = 0;
  private db: InstanceType<typeof LevelUp>;

  constructor(publicKey: string) {
    this.db = LevelUp(LevelDown(path.join(__dirname, '../../blockstore/', publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });

    this.height = 1;
    this.latestBlock = Block.genesis();
    this.db.get(1).catch(() => {
      this.db.put(this.height, JSON.stringify(this.latestBlock));
    });
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', (data) => {
          if (Number(data.key) > this.height) {
            this.height = Number(data.key);
            this.latestBlock = JSON.parse(data.value) as BlockStruct;
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
    Logger.trace(
      `Blockchain.isValid(): ${
        this.height + 1 === block.height &&
        block.previousHash === this.latestBlock.hash &&
        block.hash === Block.blockHash(block) &&
        Block.verifyBlock(block)
      }`
    );
    return (
      this.height + 1 === block.height &&
      block.previousHash === this.latestBlock.hash &&
      block.hash === Block.blockHash(block) &&
      Block.verifyBlock(block)
    );
  }

  add(block: BlockStruct) {
    this.db.put(block.height, JSON.stringify(block)).then(() => {
      this.latestBlock = block;
      this.height = block.height;
    });
  }

  getHeight(): number {
    return this.height;
  }

  async get(): Promise<Array<BlockStruct>> {
    const a: Array<BlockStruct> = [];
    return new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', (data) => {
          a[Number(data.key) - 1] = JSON.parse(data.value) as BlockStruct;
        })
        .on('end', () => {
          resolve(a);
        })
        .on('error', reject);
    });
  }

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
  }
}
