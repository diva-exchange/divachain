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
import { Server } from './server';
import { nanoid } from 'nanoid';
import { Util } from '../chain/util';
import { Vote, VoteStruct } from './message/vote';
import { Proposal, ProposalStruct } from './message/proposal';
import { Logger } from '../logger';
import { toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

export type recordTx = {
  height: number;
  tx: TransactionStruct;
  hash: string;
};

export class Pool {
  private readonly server: Server;

  private stackTransaction: Array<recordStack> = [];
  private ownTx: recordTx = {} as recordTx;

  private current: Map<string, TransactionStruct> = new Map();
  private arrayTransaction: Array<TransactionStruct> = [];

  private currentHeight: number = 0;
  private currentHash: string = '';
  private currentVote: Vote = {} as Vote;
  private mapVote: Map<string, VoteStruct> = new Map();

  private block: BlockStruct = {} as BlockStruct;

  static make(server: Server) {
    return new Pool(server);
  }

  private constructor(server: Server) {
    this.server = server;
  }

  initHeight() {
    if (!this.currentHeight) {
      this.currentHeight = this.server.getBlockchain().getHeight() + 1;
    }
  }

  stack(ident: string, commands: ArrayCommand): string | false {
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);

    // test for transaction validity, use any valid height - so 1 is just fine
    const tx = new Transaction(this.server.getWallet(), 1, ident, commands).get();
    if (
      this.server.getValidation().validateTx(1, tx) &&
      this.stackTransaction.push({ ident: ident, commands: commands }) > 0
    ) {
      return ident;
    }

    return false;
  }

  release() {
    if (this.hasBlock() || this.ownTx.height || !this.stackTransaction.length) {
      return;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    const tx: TransactionStruct = new Transaction(
      this.server.getWallet(),
      this.currentHeight,
      r.ident,
      r.commands
    ).get();
    this.ownTx = {
      height: this.currentHeight,
      tx: new Transaction(this.server.getWallet(), this.currentHeight, r.ident, r.commands).get(),
      hash: Util.hash([this.currentHeight, JSON.stringify(tx)].join()),
    };
  }

  getStack() {
    return this.stackTransaction;
  }

  getProposal(): Proposal | false {
    return this.ownTx.height
      ? new Proposal().create(
          this.server.getWallet().getPublicKey(),
          this.ownTx.height,
          this.ownTx.tx,
          this.server.getWallet().sign(this.ownTx.hash)
        )
      : false;
  }

  propose(structProposal: ProposalStruct): boolean {
    if (structProposal.height !== this.currentHeight || this.hasBlock()) {
      return false;
    }

    // pool already contains a tx from this origin
    if (this.current.has(structProposal.origin)) {
      return false;
    }

    // check Tx validity
    if (!this.server.getValidation().validateTx(structProposal.height, structProposal.tx)) {
      return false;
    }

    this.current.set(structProposal.origin, structProposal.tx);

    return true;
  }

  getArrayTransaction(): Array<TransactionStruct> {
    return this.arrayTransaction;
  }

  lock(): Vote | false {
    if (!this.current.size) {
      return false;
    }

    if (!this.currentVote.origin) {
      this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));

      this.currentHash = Util.hash(JSON.stringify(this.arrayTransaction));

      this.currentVote = new Vote().create(
        this.server.getWallet().getPublicKey(),
        this.currentHeight,
        this.currentHash,
        this.server.getWallet().sign(Util.hash([this.currentHeight, this.currentHash].join()))
      );
    }

    return this.currentVote;
  }

  vote(structVote: VoteStruct): boolean {
    if (structVote.height !== this.currentHeight || this.hasBlock()) {
      return false;
    }

    // no double voting
    if (this.mapVote.has(structVote.origin)) {
      return false;
    }

    this.mapVote.set(structVote.origin, structVote);
    const stakeVotes = [...this.mapVote.keys()].reduce((s, pk) => {
      return s + this.server.getBlockchain().getStake(pk);
    }, 0);

    // not enough votes yet
    if (stakeVotes < this.server.getBlockchain().getQuorum()) {
      return true;
    }

    const quorum = this.server.getBlockchain().getQuorum();
    const quorumTotal = this.server.getBlockchain().getTotalQuorum();
    let isDeadlocked = true;
    const mapStakes: Map<string, number> = new Map();
    const arrayVotes: Array<{ origin: string; sig: string }> = [];
    for (const v of [...this.mapVote.values()]) {
      let stake = mapStakes.get(v.hash) || 0;
      stake += this.server.getBlockchain().getStake(v.origin);
      if (v.hash === this.currentHash) {
        arrayVotes.push({ origin: v.origin, sig: v.sig });
      }
      mapStakes.set(v.hash, stake);
      if (stake >= quorum) {
        isDeadlocked = false;
        break;
      }
      isDeadlocked = isDeadlocked && quorum - stake > quorumTotal - stakeVotes;
    }

    if ((mapStakes.get(this.currentHash) || 0) >= quorum) {
      this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayTransaction);
      this.block.votes = arrayVotes;
    }

    if (!isDeadlocked) {
      return true;
    }

    //@FIXME logging
    Logger.trace(`${toB32(this.server.config.udp)}.b32.i2p isDeadlocked ${stakeVotes} / ${quorumTotal}`);

    this.arrayTransaction = [];
    this.currentHash = '';
    this.currentVote = {} as Vote;
    this.mapVote = new Map();

    return false;
  }

  getArrayVote(): Array<any> {
    return [...this.mapVote];
  }

  hasBlock(): boolean {
    return !!this.block.hash;
  }

  getBlock(): BlockStruct {
    return this.block.hash ? this.block : ({} as BlockStruct);
  }

  clear(block: BlockStruct) {
    if (
      this.ownTx.height &&
      !block.tx.some((t) => {
        return t.sig === this.ownTx.tx.sig;
      })
    ) {
      this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
    }
    this.ownTx = {} as recordTx;
    this.currentHeight = block.height + 1;
    this.current = new Map();
    this.arrayTransaction = [];
    this.currentHash = '';
    this.currentVote = {} as Vote;
    this.block = {} as BlockStruct;
    this.mapVote = new Map();
  }
}
