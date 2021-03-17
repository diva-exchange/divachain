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

import { ChainUtil } from '../util/chain-util';
import { Wallet } from '../transaction/wallet';

import fs from 'fs';
import path from 'path';
import { VoteStruct } from '../p2p/message/vote';

export class Block {
  readonly version: number;
  readonly created: number;
  readonly previousHash: string;
  readonly hash: string; // hash
  readonly transactions: Array<object>; //@FIXME
  readonly proposer: string;
  readonly signature: string;
  readonly height: number;
  votes: Array<VoteStruct>;
  commits: Array<any>; //@FIXME CommitStruct

  constructor(
    created: number,
    previousHash: string,
    hash: string,
    transactions: Array<object>,
    proposer: string,
    signature: string,
    height: number
  ) {
    this.version = 1; //@FIXME
    this.created = created;
    this.previousHash = previousHash;
    this.hash = hash;
    this.transactions = transactions;
    this.proposer = proposer;
    this.signature = signature;
    this.height = height;

    this.votes = [];
    this.commits = [];
  }

  toString(): string {
    return `
      Version        : ${this.version}
      Created        : ${this.created}
      Previous Hash  : ${this.previousHash}
      Hash           : ${this.hash}
      Transactions   : ${JSON.stringify(this.transactions)}
      Proposer       : ${this.proposer}
      Signature      : ${this.signature}
      Height         : ${this.height}`;
  }

  static genesis(): Block {
    const { created, previousHash, hash, transactions, proposer, signature, height } = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../config/genesis.json')).toString()
    );

    return new this(created, previousHash, hash, transactions, proposer, signature, height);
  }

  static createBlock(previousBlock: Block, transactions: Array<object>, wallet: Wallet): Block {
    const created = Date.now();
    const previousHash = previousBlock.hash;
    const hash = ChainUtil.hash(created + previousHash + JSON.stringify(transactions));
    const proposer = wallet.getPublicKey();
    const signature = Block.signBlockHash(hash, wallet);
    return new this(created, previousHash, hash, transactions, proposer, signature, previousBlock.height + 1);
  }

  static blockHash(block: Block): string {
    const { created, previousHash, transactions } = block;
    return ChainUtil.hash(created + previousHash + JSON.stringify(transactions));
  }

  static signBlockHash(hash: string, wallet: Wallet): string {
    return wallet.sign(hash);
  }

  static verifyBlock(block: Block): boolean {
    return ChainUtil.verifySignature(block.proposer, block.signature, block.hash);
  }

  static verifyProposer(block: Block, proposer: string): boolean {
    return block.proposer === proposer;
  }
}
