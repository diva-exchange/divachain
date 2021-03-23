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

import { ChainUtil } from './chain-util';
import { Wallet } from './wallet';
import fs from 'fs';
import path from 'path';
import { VoteStruct } from '../p2p/message/vote';
import { TransactionStruct } from '../p2p/message/transaction';

export type BlockStruct = {
  version: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  transactions: Array<TransactionStruct>;
  origin: string;
  signature: string;
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
  readonly transactions: Array<TransactionStruct>;
  readonly origin: string;
  readonly signature: string;

  constructor(previousBlock: BlockStruct, transactions: Array<TransactionStruct>, wallet: Wallet) {
    this.previousBlock = previousBlock;
    this.version = 1; //@FIXME
    this.timestamp = Date.now();
    this.previousHash = previousBlock.hash;
    this.height = previousBlock.height + 1;
    this.transactions = transactions;
    this.hash = ChainUtil.hash(
      this.previousHash + this.version + this.timestamp + this.height + JSON.stringify(transactions)
    );
    this.origin = wallet.getPublicKey();
    this.signature = wallet.sign(this.hash);
  }

  get(): BlockStruct {
    return {
      version: this.version,
      timestamp: this.timestamp,
      previousHash: this.previousHash,
      hash: this.hash,
      transactions: this.transactions,
      origin: this.origin,
      signature: this.signature,
      height: this.height,
      votes: [],
    } as BlockStruct;
  }

  static genesis(): BlockStruct {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/genesis.json')).toString());
  }

  static blockHash(block: BlockStruct): string {
    const { version, timestamp, previousHash, height, transactions } = block;
    return ChainUtil.hash(previousHash + version + timestamp + height + JSON.stringify(transactions));
  }

  static verifyBlock(block: BlockStruct): boolean {
    return ChainUtil.verifySignature(block.origin, block.signature, block.hash);
  }
}
