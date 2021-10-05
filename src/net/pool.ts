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

'use strict';

import { ArrayCommand, Transaction, TransactionStruct } from '../chain/transaction';
import { Wallet } from '../chain/wallet';
import { Block, BlockStruct } from '../chain/block';
import { nanoid } from 'nanoid';
import { Validation } from './validation';
import { LockStruct } from './message/lock';
import { Util } from '../chain/util';
import { Blockchain } from '../chain/blockchain';
import { VoteStruct } from './message/vote';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

type recordLock = {
  origin: string;
  stake: number;
};

type recordVote = {
  origin: string;
  sig: string;
  stake: number;
};

export class Pool {
  private readonly wallet: Wallet;
  private readonly publicKey: string;
  private readonly blockchain: Blockchain;

  private stackTransaction: Array<recordStack> = [];
  private inTransit: TransactionStruct = {} as TransactionStruct;

  private current: Map<string, TransactionStruct> = new Map();
  private cacheCurrent: Array<TransactionStruct> = [];
  private hashCurrent: string = '';

  private arrayLocks: Array<recordLock> = [];
  private block: BlockStruct = {} as BlockStruct;

  private arrayVotes: Array<recordVote> = [];

  constructor(wallet: Wallet, blockchain: Blockchain) {
    this.wallet = wallet;
    this.publicKey = this.wallet.getPublicKey();
    this.blockchain = blockchain;
  }

  stack(ident: string, commands: ArrayCommand): string | false {
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);

    // test for transaction validity, use any valid height - so 1 is just fine
    const tx = new Transaction(this.wallet, 1, ident, commands).get();
    return Validation.validateTx(1, tx) && this.stackTransaction.push({ ident: ident, commands: commands }) > 0
      ? ident
      : false;
  }

  release(height: number): TransactionStruct | false {
    if (this.inTransit.ident || !this.stackTransaction.length) {
      return this.inTransit.ident ? this.inTransit : false;
    }
    const r: recordStack = this.stackTransaction.shift() as recordStack;
    this.inTransit = new Transaction(this.wallet, height, r.ident, r.commands).get();
    return this.inTransit;
  }

  getStack() {
    return this.stackTransaction;
  }

  add(tx: TransactionStruct): boolean {
    if (this.current.has(tx.origin)) {
      return false;
    }

    this.current.set(tx.origin, tx);
    this.cacheCurrent = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
    this.hashCurrent = Util.hash(this.cacheCurrent.reduce((s, tx) => s + tx.sig, ''));
    this.block = {} as BlockStruct;
    this.arrayLocks = [];
    this.arrayVotes = [];
    return true;
  }

  get(): Array<TransactionStruct> {
    return this.cacheCurrent;
  }

  getArrayLocks(): Array<recordLock> {
    return this.arrayLocks;
  }

  getArrayVotes(): Array<recordVote> {
    return this.arrayVotes;
  }

  getHash(): string {
    return this.hashCurrent;
  }

  getBlock(): BlockStruct {
    return this.block.hash ? this.block : ({} as BlockStruct);
  }

  lock(lock: LockStruct, stake: number, quorum: number): boolean {
    if (lock.hash !== this.hashCurrent || this.arrayLocks.some((r) => r.origin === lock.origin)) {
      return false;
    }

    this.arrayLocks.push({ origin: lock.origin, stake: stake });
    if (this.arrayLocks.reduce((p, r) => p + r.stake, 0) >= quorum) {
      this.block = Block.make(this.blockchain.getLatestBlock(), this.cacheCurrent);
    }
    return true;
  }

  hasLock() {
    return !!this.block.hash;
  }

  addVote(vote: VoteStruct, stake: number): boolean {
    if (this.block.hash !== vote.block.hash) {
      return false;
    }

    if (this.arrayVotes.some((r) => r.origin === vote.origin)) {
      return false;
    }

    this.arrayVotes.push({ origin: vote.origin, sig: vote.sig, stake: stake });
    return true;
  }

  hasQuorum(quorum: number): boolean {
    if (!this.block.votes.length) {
      if (this.arrayVotes.reduce((p, v) => p + v.stake, 0) >= quorum) {
        this.block.votes = this.arrayVotes
          .map((_r) => {
            return { origin: _r.origin, sig: _r.sig };
          })
          .sort((a, b) => (a.origin > b.origin ? 1 : -1));
        return true;
      }
    }
    return false;
  }

  clear(block: BlockStruct) {
    if (
      this.inTransit.sig &&
      !block.tx.some((t) => {
        return t.sig === this.inTransit.sig;
      })
    ) {
      this.stackTransaction.unshift({ ident: this.inTransit.ident, commands: this.inTransit.commands });
    }
    this.inTransit = {} as TransactionStruct;
    this.current = new Map();
    this.arrayLocks = [];
    this.block = {} as BlockStruct;
    this.arrayVotes = [];
    this.cacheCurrent = [];
    this.hashCurrent = '';
  }
}
