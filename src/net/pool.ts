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

'use strict';

import { ArrayCommand, Transaction, TransactionStruct } from '../chain/transaction';
import { Block, BlockStruct } from '../chain/block';
import { Server } from './server';
import { nanoid } from 'nanoid';
import { Util } from '../chain/util';
import { Vote, VoteStruct } from './message/vote';
import { Proposal, ProposalStruct } from './message/proposal';
import { Logger } from '../logger';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

export type recordTx = {
  height: number;
  tx: TransactionStruct;
};

export class Pool {
  private readonly server: Server;

  private stackTransaction: Array<recordStack> = [];
  private ownTx: recordTx = {} as recordTx;
  private ownProposal: Proposal = {} as Proposal;

  private arrayPoolTx: Array<TransactionStruct> = [];

  private current: Map<string, TransactionStruct> = new Map(); // Map<origin, TransactionStruct>
  private currentHash: string = '';
  private currentVote: Vote = {} as Vote;
  private mapVotes: Map<number, Map<string, VoteStruct>> = new Map(); // Map<txlength, Map<origin, VoteStruct>>

  private block: BlockStruct = {} as BlockStruct;

  static make(server: Server) {
    return new Pool(server);
  }

  private constructor(server: Server) {
    this.server = server;
  }

  stack(commands: ArrayCommand, ident: string = ''): string | false {
    const height = this.server.getBlockchain().getHeight() + 1;
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);
    if (
      !this.server
        .getValidation()
        .validateTx(height, new Transaction(this.server.getWallet(), height, ident, commands).get())
    ) {
      return false;
    }

    this.stackTransaction.push({ ident: ident, commands: commands });
    return ident;
  }

  getStack() {
    return this.stackTransaction;
  }

  getOwnProposal(): Proposal | false {
    const height = this.server.getBlockchain().getHeight() + 1;
    while (!this.ownTx.height && this.stackTransaction.length) {
      const r: recordStack = this.stackTransaction.shift() as recordStack;
      const tx: TransactionStruct = new Transaction(this.server.getWallet(), height, r.ident, r.commands).get();

      if (this.server.getValidation().validateTx(height, tx)) {
        this.ownTx = {
          height: height,
          tx: tx,
        };
        this.updateOwnProposal();
      }
    }

    return this.ownTx.height > 0 ? this.ownProposal : false;
  }

  updateOwnProposal() {
    this.ownTx.height > 0 &&
      (this.ownProposal = new Proposal().create(this.server.getWallet(), this.ownTx.height, this.ownTx.tx));
  }

  propose(structProposal: ProposalStruct): boolean {
    const height = this.server.getBlockchain().getHeight() + 1;
    if (structProposal.height !== height) {
      return false;
    }

    // pool already contains a tx from this origin or the tx does not validate
    if (this.current.has(structProposal.origin) || !this.server.getValidation().validateTx(height, structProposal.tx)) {
      return false;
    }
    this.current.set(structProposal.origin, structProposal.tx);
    this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
    this.currentHash = Util.hash(JSON.stringify(this.arrayPoolTx));
    this.currentVote = new Vote().create(this.server.getWallet(), height, this.arrayPoolTx.length, this.currentHash);

    return true;
  }

  public getCurrentVote(): Vote | false {
    if (this.current.size === 0) {
      return false;
    }

    return this.currentVote;
  }

  vote(structVote: VoteStruct): boolean {
    const height = this.server.getBlockchain().getHeight() + 1;
    if (structVote.height !== height) {
      return false;
    }

    const mapOrigins = this.mapVotes.get(structVote.txlength) || new Map(); // Map<origin, VoteStruct>

    // no double voting, VERY important for PBFT to function
    if (mapOrigins.has(structVote.origin)) {
      return false;
    }
    mapOrigins.set(structVote.origin, structVote);
    this.mapVotes.set(structVote.txlength, mapOrigins);

    //@TODO weighted PBFT
    // PBFT
    const quorum = this.server.getBlockchain().getQuorum();
    if (structVote.txlength !== this.arrayPoolTx.length || mapOrigins.size < quorum) {
      return false;
    }

    const arrayVotes = [...mapOrigins.values()].filter((v) => v.hash === this.currentHash);
    if (arrayVotes.length >= quorum) {
      this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayPoolTx);
      this.block.votes = arrayVotes.map((v) => {
        return { origin: v.origin, sig: v.sig };
      });
      return true;
    }

    //@TODO test for deadlocks here
    if (arrayVotes.length + (quorum * 1.5 - mapOrigins.size) < quorum) {
      //@TODO handle deadlock
      //@FIXME logging
      Logger.trace(`${this.server.config.port}: deadlocked ${this.arrayPoolTx.length}`);
    }

    return false;
  }

  getArrayPoolTx(): Array<TransactionStruct> {
    return this.arrayPoolTx;
  }

  getArrayPoolVotes(): Array<Array<VoteStruct>> {
    const a: Array<any> = [];
    this.mapVotes.forEach((v: Map<string, VoteStruct>, txlength: number) => {
      a[txlength] = [];
      v.forEach((vs: VoteStruct) => {
        a[txlength].push(vs);
      });
    });
    return a;
  }

  getBlock(): BlockStruct {
    return this.block;
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
    this.ownProposal = {} as Proposal;

    this.current = new Map();
    this.arrayPoolTx = [];
    this.currentHash = '';
    this.currentVote = {} as Vote;
    this.mapVotes = new Map();

    this.block = {} as BlockStruct;
  }
}
