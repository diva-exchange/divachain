/**
 * Copyright (C) 2021-2022 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Util } from './util';
import { TransactionStruct } from './transaction';
import { BLOCK_VERSION } from '../config';
import { VoteStruct } from '../net/message/confirm-block';

export type BlockStruct = {
  version: number;
  previousHash: string;
  hash: string;
  tx: Array<TransactionStruct>;
  height: number;
  votes: Array<VoteStruct>;
};

export class Block {
  readonly previousBlock: BlockStruct;
  readonly version: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly tx: Array<TransactionStruct>;
  readonly height: number;

  static make(previousBlock: BlockStruct, tx: Array<TransactionStruct>): BlockStruct {
    return new Block(previousBlock, tx).get();
  }

  private constructor(previousBlock: BlockStruct, tx: Array<TransactionStruct>) {
    this.previousBlock = previousBlock;
    this.version = BLOCK_VERSION;
    this.previousHash = previousBlock.hash;
    this.height = previousBlock.height + 1;
    this.tx = tx;
    this.hash = Util.hash([this.version, this.previousHash, JSON.stringify(this.tx), this.height].join());
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
