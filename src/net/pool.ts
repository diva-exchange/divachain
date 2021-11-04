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
import { Validation } from './validation';
import { Util } from '../chain/util';
import { VoteStruct } from './message/vote';
import { Server } from './server';
import { nanoid } from 'nanoid';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

type recordVote = {
  origin: string;
  sig: string;
};

export class Pool {
  private readonly server: Server;

  private stackTransaction: Array<recordStack> = [];
  private inTransit: TransactionStruct = {} as TransactionStruct;

  private currentHeight: number = 0;
  private current: Map<string, TransactionStruct> = new Map();
  private hashCurrent: string = '';

  private arrayLocks: Array<string> = [];
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
    if (this.currentHeight === height && this.inTransit.ident) {
      return this.inTransit;
    }
    this.currentHeight = height;
    if (this.inTransit.ident) {
      this.stackTransaction.unshift({ ident: this.inTransit.ident, commands: this.inTransit.commands });
    }
    if (!this.stackTransaction.length) {
      return false;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    this.inTransit = new Transaction(this.server.getWallet(), this.currentHeight, r.ident, r.commands).get();
    return this.inTransit;
  }

  getStack() {
    return this.stackTransaction;
  }

  add(tx: TransactionStruct): boolean {
    if (this.hasLock() || this.current.has(tx.origin)) {
      return false;
    }

    this.current.set(tx.origin, tx);
    this.hashCurrent = Util.hash([...this.current.keys()].sort().join());
    this.arrayLocks = [];
    this.stakeLocks = 0;

    return true;
  }

  getArrayLocks(): Array<string> {
    return this.arrayLocks;
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

  lock(lock: VoteStruct) {
    if (this.hasLock() || lock.hash !== this.hashCurrent || this.arrayLocks.includes(lock.origin)) {
      return;
    }

    this.arrayLocks.push(lock.origin);
    this.stakeLocks += this.server.getNetwork().getStake(lock.origin);

    if (this.stakeLocks >= this.server.getNetwork().getQuorum()) {
      this.block = Block.make(
        this.server.getBlockchain().getLatestBlock(),
        [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1))
      );
      this.mapVotes = new Map();
      this.stakeVotes = 0;
    }
  }

  hasLock(): boolean {
    return !!this.block.hash;
  }

  addVote(vote: VoteStruct): boolean {
    const stake = this.server.getNetwork().getStake(vote.origin);
    if (stake <= 0 || this.block.hash !== vote.hash || this.mapVotes.has(vote.origin)) {
      return false;
    }

    this.mapVotes.set(vote.origin, { origin: vote.origin, sig: vote.sig });
    this.stakeVotes += stake;
    if (this.stakeVotes >= this.server.getNetwork().getQuorum()) {
      this.block.votes = this.getArrayVotes();
    }

    return !!this.block.votes.length;
  }

  clear(block: BlockStruct = {} as BlockStruct) {
    if (
      this.inTransit.sig &&
      (!block.hash || !block.tx.some((t) => {
        return t.sig === this.inTransit.sig;
      }))
    ) {
      this.stackTransaction.unshift({ ident: this.inTransit.ident, commands: this.inTransit.commands });
    }
    this.inTransit = {} as TransactionStruct;
    this.currentHeight = 0;
    this.current = new Map();
    this.arrayLocks = [];
    this.stakeLocks = 0;
    this.block = {} as BlockStruct;
    this.mapVotes = new Map();
    this.stakeVotes = 0;
    this.hashCurrent = '';
  }
}
