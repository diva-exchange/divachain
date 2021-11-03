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
import { Block, BlockStruct } from '../chain/block';
import { nanoid } from 'nanoid';
import { Validation } from './validation';
import { Util } from '../chain/util';
import { VoteStruct } from './message/vote';
import { Server } from './server';

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
};

export class Pool {
  private readonly server: Server;

  private stackTransaction: Array<recordStack> = [];
  private inTransit: TransactionStruct = {} as TransactionStruct;

  private current: Map<string, TransactionStruct> = new Map();
  private cacheCurrent: Array<TransactionStruct> = [];
  private hashCurrent: string = '';

  private mapLocks: Map<string, recordLock> = new Map();
  private stakeLocks: number = 0;
  private block: BlockStruct = {} as BlockStruct;

  private mapVotes: Map<string, recordVote> = new Map();
  private stakeVotes: number = 0;

  static make(server: Server) {
    return new Pool(server);
  }

  private constructor(server: Server) {
    this.server = server;
  }

  stack(ident: string, commands: ArrayCommand): string | false {
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);

    // test for transaction validity, use any valid height - so 1 is just fine
    const tx = new Transaction(this.server.getWallet(), 1, ident, commands).get();
    return Validation.validateTx(1, tx) && this.stackTransaction.push({ ident: ident, commands: commands }) > 0
      ? ident
      : false;
  }

  release(height: number): TransactionStruct | false {
    if (this.inTransit.ident) {
      return this.inTransit;
    }
    if (!this.stackTransaction.length) {
      return false;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    this.inTransit = new Transaction(this.server.getWallet(), height, r.ident, r.commands).get();
    return this.inTransit;
  }

  getStack() {
    return this.stackTransaction;
  }

  add(tx: TransactionStruct) {
    if (this.hasLock() || this.current.has(tx.origin)) {
      return;
    }

    this.current.set(tx.origin, tx);
    this.cacheCurrent = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
    this.hashCurrent = Util.hash(this.cacheCurrent.reduce((s, tx) => s + tx.sig, ''));
    this.block = {} as BlockStruct;
    this.mapLocks = new Map();
    this.stakeLocks = 0;
    this.mapVotes = new Map();
    this.stakeVotes = 0;
  }

  get(): Array<TransactionStruct> {
    return this.cacheCurrent;
  }

  getArrayLocks(): Array<recordLock> {
    return [...this.mapLocks.values()];
  }

  getArrayVotes(): Array<recordVote> {
    return [...this.mapVotes.values()];
  }

  getHash(): string {
    return this.hashCurrent;
  }

  getBlock(): BlockStruct {
    return this.block.hash ? this.block : ({} as BlockStruct);
  }

  lock(lock: VoteStruct, stake: number, quorum: number) {
    if (lock.hash !== this.hashCurrent || this.mapLocks.has(lock.origin)) {
      return;
    }

    this.mapLocks.set(lock.origin, { origin: lock.origin, stake: stake });
    this.stakeLocks += stake;
    if (this.stakeLocks >= quorum) {
      this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.cacheCurrent);
    }
  }

  hasLock(): boolean {
    return !!this.block.hash;
  }

  addVote(vote: VoteStruct, stake: number): boolean {
    if (stake <= 0 || this.block.hash !== vote.hash) {
      return false;
    }

    if (!this.mapVotes.has(vote.origin)) {
      this.mapVotes.set(vote.origin, { origin: vote.origin, sig: vote.sig });
      this.stakeVotes += stake;
    }

    return true;
  }

  hasQuorum(quorum: number): boolean {
    if (this.hasLock() && !this.block.votes.length) {
      if (this.stakeVotes >= quorum) {
        this.block.votes = this.getArrayVotes();
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
    this.mapLocks = new Map();
    this.stakeLocks = 0;
    this.block = {} as BlockStruct;
    this.mapVotes = new Map();
    this.stakeVotes = 0;
    this.cacheCurrent = [];
    this.hashCurrent = '';
  }
}
