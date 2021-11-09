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
import { Util } from '../chain/util';
import { VoteStruct } from './message/vote';
import { Server } from './server';
import { nanoid } from 'nanoid';
import { TxProposalStruct } from './message/tx-proposal';
import { Message } from './message/message';

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
  private inTransit: TxProposalStruct = {} as TxProposalStruct;

  private current: Map<string, TransactionStruct> = new Map();
  private cacheCurrent: Array<TransactionStruct> = [];
  private hashCurrent: string = '';
  private heightCurrent: number;

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
    this.heightCurrent = server.getBlockchain().getHeight() + 1;
  }

  stack(ident: string, commands: ArrayCommand): string | false {
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);

    // test for transaction validity, use any valid height - so 1 is just fine
    const tx = new Transaction(this.server.getWallet(), 1, ident, commands).get();
    return this.server.getValidation().validateTx(1, tx) &&
      this.stackTransaction.push({ ident: ident, commands: commands }) > 0
      ? ident
      : false;
  }

  release(): TxProposalStruct | false {
    if (!this.inTransit.height && this.stackTransaction.length) {
      const r: recordStack = this.stackTransaction.shift() as recordStack;
      this.inTransit = {
        type: Message.TYPE_TX_PROPOSAL,
        height: this.heightCurrent,
        tx: new Transaction(this.server.getWallet(), this.heightCurrent, r.ident, r.commands).get(),
      };
    }
    return this.inTransit.height ? this.inTransit : false;
  }

  getStack() {
    return this.stackTransaction;
  }

  add(p: TxProposalStruct): boolean {
    if (p.height !== this.heightCurrent || this.hasLock() || this.current.has(p.tx.origin)) {
      return false;
    }

    this.current.set(p.tx.origin, p.tx);
    this.cacheCurrent = [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1));
    this.hashCurrent = Util.hash([...this.current.keys()].sort().join(''));
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
    if (lock.hash !== this.hashCurrent || this.hasLock() || this.arrayLocks.includes(lock.origin)) {
      return;
    }

    this.arrayLocks.push(lock.origin);
    this.stakeLocks += this.server.getNetwork().getStake(lock.origin);

    if (this.stakeLocks >= this.server.getNetwork().getQuorum()) {
      this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.cacheCurrent);
      this.mapVotes = new Map();
      this.stakeVotes = 0;
    }
  }

  hasLock(): boolean {
    return !!this.block.hash;
  }

  addVote(vote: VoteStruct): boolean {
    if (this.block.hash !== vote.hash || this.mapVotes.has(vote.origin)) {
      return false;
    }

    const stake = this.server.getNetwork().getStake(vote.origin);
    if (stake > 0) {
      this.mapVotes.set(vote.origin, { origin: vote.origin, sig: vote.sig });
      this.stakeVotes += stake;
    }

    if (this.stakeVotes >= this.server.getNetwork().getQuorum()) {
      this.block.votes = this.getArrayVotes();
    }

    return !!this.block.votes.length;
  }

  clear(block: BlockStruct) {
    if (
      this.inTransit.height &&
      !block.tx.some((t) => {
        return t.sig === this.inTransit.tx.sig;
      })
    ) {
      this.stackTransaction.unshift({ ident: this.inTransit.tx.ident, commands: this.inTransit.tx.commands });
    }
    this.inTransit = {} as TxProposalStruct;
    this.heightCurrent = block.height + 1;
    this.current = new Map();
    this.arrayLocks = [];
    this.stakeLocks = 0;
    this.block = {} as BlockStruct;
    this.mapVotes = new Map();
    this.stakeVotes = 0;
    this.hashCurrent = '';
  }
}
