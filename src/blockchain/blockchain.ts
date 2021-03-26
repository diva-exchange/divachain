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
  private static latestBlock: BlockStruct;
  private static height: number = 0;
  private static db: InstanceType<typeof LevelUp>;
  private static hashes: Array<string> = [];

  static async init(publicKey: string): Promise<void> {
    // singleton
    if (Blockchain.db) {
      return Promise.resolve();
    }

    Blockchain.db = LevelUp(LevelDown(path.join(__dirname, '../../blockstore/', publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });

    Blockchain.height = 1;
    Blockchain.latestBlock = Block.genesis();
    Blockchain.hashes.push(Blockchain.latestBlock.hash);
    Blockchain.db.get(1).catch(() => {
      Blockchain.db.put(Blockchain.height, JSON.stringify(Blockchain.latestBlock));
    });

    return new Promise((resolve, reject) => {
      Blockchain.db
        .createReadStream()
        .on('data', (data) => {
          if (Number(data.key) > Blockchain.height) {
            Blockchain.height = Number(data.key);
            Blockchain.latestBlock = JSON.parse(data.value) as BlockStruct;
            Blockchain.hashes.push(Blockchain.latestBlock.hash);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  static async shutdown() {
    await Blockchain.db.close();
  }

  static isValid(block: BlockStruct): boolean {
    Logger.trace(
      `Blockchain.isValid(): ${
        Blockchain.height + 1 === block.height &&
        block.previousHash === Blockchain.latestBlock.hash &&
        block.hash === Block.blockHash(block) &&
        Block.verifyBlock(block)
      }`
    );
    return (
      Blockchain.height + 1 === block.height &&
      block.previousHash === Blockchain.latestBlock.hash &&
      block.hash === Block.blockHash(block) &&
      Block.verifyBlock(block)
    );
  }

  static has(hash: string): boolean {
    return Blockchain.hashes.includes(hash);
  }

  static add(block: BlockStruct) {
    Blockchain.latestBlock = block;
    Blockchain.height = block.height;
    Blockchain.hashes.push(Blockchain.latestBlock.hash);
    Blockchain.db.put(block.height, JSON.stringify(block));
  }

  static async get(): Promise<Array<BlockStruct>> {
    const a: Array<BlockStruct> = [];
    return new Promise((resolve, reject) => {
      Blockchain.db
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

  static getLatestBlock(): BlockStruct {
    return Blockchain.latestBlock;
  }
}
