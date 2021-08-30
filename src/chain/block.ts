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

import { Util } from './util';
import { TransactionStruct } from './transaction';
import { Validation } from '../net/validation';

export type BlockStruct = {
  version: number;
  previousHash: string;
  hash: string;
  tx: Array<TransactionStruct>;
  height: number;
  votes: Array<{ origin: string; sig: string }>;
};

export class Block {
  readonly previousBlock: BlockStruct;
  readonly version: number;
  readonly height: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly tx: Array<TransactionStruct>;

  static make(previousBlock: BlockStruct, tx: Array<TransactionStruct>): BlockStruct {
    const b = new Block(previousBlock, tx).get();
    if (!Validation.validateBlock(b)) {
      throw new Error('Invalid Block');
    }
    return b;
  }

  private constructor(previousBlock: BlockStruct, tx: Array<TransactionStruct>) {
    this.previousBlock = previousBlock;
    this.version = 1; //@FIXME
    this.previousHash = previousBlock.hash;
    this.height = previousBlock.height + 1;
    this.tx = tx;
    this.hash = Util.hash(this.previousHash + this.version + this.height + JSON.stringify(this.tx));
  }

  get(): BlockStruct {
    return {
      version: this.version,
      previousHash: this.previousHash,
      hash: this.hash,
      tx: this.tx,
      height: this.height,
      votes: [],
    } as BlockStruct;
  }
}
