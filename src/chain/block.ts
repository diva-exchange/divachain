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
import { Wallet } from './wallet';
import { VoteStruct } from '../net/message/vote';
import { TransactionStruct } from '../net/message/transaction';

export type BlockStruct = {
  version: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  tx: Array<TransactionStruct>;
  origin: string;
  sig: string;
  height: number;
  votes: Array<VoteStruct>;
};

export class Block {
  readonly previousBlock: BlockStruct;
  readonly version: number;
  readonly timestamp: number;
  readonly height: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly tx: Array<TransactionStruct>;
  readonly origin: string;
  readonly sig: string;

  constructor(previousBlock: BlockStruct, tx: Array<TransactionStruct>, wallet: Wallet) {
    this.previousBlock = previousBlock;
    this.version = 1; //@FIXME
    this.timestamp = Date.now();
    this.previousHash = previousBlock.hash;
    this.height = previousBlock.height + 1;
    this.tx = tx.sort((a, b) => (a.origin > b.origin ? 1 : -1));
    this.hash = Util.hash(this.previousHash + this.version + this.timestamp + this.height + JSON.stringify(this.tx));
    this.origin = wallet.getPublicKey();
    this.sig = wallet.sign(this.hash);
  }

  get(): BlockStruct {
    return {
      version: this.version,
      timestamp: this.timestamp,
      previousHash: this.previousHash,
      hash: this.hash,
      tx: this.tx,
      origin: this.origin,
      sig: this.sig,
      height: this.height,
      votes: [],
    } as BlockStruct;
  }
}
