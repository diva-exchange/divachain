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

type recordVote = {
  origin: string;
  sig: string;
  stake: number;
};

export class Pool {
  private readonly server: Server;

  private stackTransaction: Array<recordStack> = [];
  private ownTx: recordTx = {} as recordTx;

  private current: Map<string, TransactionStruct> = new Map();
  private currentHash: string = '';
  private arrayTransaction: Array<TransactionStruct> = [];
  private heightCurrent: number = 0;

  private block: BlockStruct = {} as BlockStruct;

  private mapVote: Map<string, Array<recordVote>> = new Map();

  static make(server: Server) {
    return new Pool(server);
  }

  private constructor(server: Server) {
    this.server = server;
  }

  initHeight() {
    if (!this.heightCurrent) {
      this.heightCurrent = this.server.getBlockchain().getHeight() + 1;
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
      this.heightCurrent,
      r.ident,
      r.commands
    ).get();
    this.ownTx = {
      height: this.heightCurrent,
      tx: new Transaction(this.server.getWallet(), this.heightCurrent, r.ident, r.commands).get(),
      hash: Util.hash([this.heightCurrent, JSON.stringify(tx)].join()),
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
    if (structProposal.height !== this.heightCurrent || this.hasBlock()) {
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
    this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
    this.currentHash = Util.hash(this.arrayTransaction.reduce((s, t) => s + t.origin, ''));
    this.mapVote = new Map();

    return true;
  }

  getArrayTransaction(): Array<TransactionStruct> {
    return this.arrayTransaction;
  }

  vote(structVote: VoteStruct): boolean {
    if (structVote.height !== this.heightCurrent || this.hasBlock()) {
      return false;
    }

    // hashes have to match
    if (this.currentHash !== structVote.hash) {
      return false;
    }

    const arrayVotes = this.mapVote.get(structVote.origin) || [];
    //@FIXME rounds hardcoded
    const rounds = 2; //this.server.getBlockchain().roundsPBFT();
    if (arrayVotes.length < rounds) {
      arrayVotes.push({
        origin: structVote.origin,
        sig: structVote.sig,
        stake: this.server.getBlockchain().getStake(structVote.origin),
      });
      this.mapVote.set(structVote.origin, arrayVotes);

      const aVotes = [...this.mapVote.values()].filter((a) => a.length === rounds);
      const stake = aVotes.reduce((sum, a) => sum + a[rounds - 1].stake, 0);
      if (stake >= this.server.getBlockchain().getQuorum()) {
        this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayTransaction);
        this.block.votes = aVotes.map((a) => {
          return { origin: a[rounds - 1].origin, sig: a[rounds - 1].sig };
        });
      }
    }

    return true;
  }

  getArrayVote(): Array<any> {
    return [...this.mapVote];
  }

  getVote(): Vote | false {
    return this.currentHash.length > 0
      ? new Vote().create(
          Util.hash(JSON.stringify([...this.mapVote])),
          this.server.getWallet().getPublicKey(),
          this.heightCurrent,
          this.currentHash,
          this.server.getWallet().sign(Util.hash([this.heightCurrent, this.currentHash].join()))
        )
      : false;
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
    this.heightCurrent = block.height + 1;
    this.current = new Map();
    this.arrayTransaction = [];
    this.currentHash = '';
    this.block = {} as BlockStruct;
    this.mapVote = new Map();
  }
}
