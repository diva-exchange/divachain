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
import { Lock, LockStruct } from './message/lock';

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

  private current: Map<string, TransactionStruct> = new Map();
  private currentHash: string = '';
  private arrayTransaction: Array<TransactionStruct> = [];
  private heightCurrent: number = 0;

  private stakeLock: number = 0;
  private roundLock: number = 0;
  private block: BlockStruct = {} as BlockStruct;

  private mapVote: Map<string, string> = new Map();

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

  release(): boolean {
    if (this.hasBlock() || this.ownTx.height || !this.stackTransaction.length) {
      return false;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    this.ownTx = {
      height: this.heightCurrent,
      tx: new Transaction(this.server.getWallet(), this.heightCurrent, r.ident, r.commands).get(),
    };
    this.current.set(this.server.getWallet().getPublicKey(), this.ownTx.tx);
    this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1));
    this.currentHash = Util.hash([this.heightCurrent, this.arrayTransaction.reduce((s, t) => s + t.sig, '')].join());
    return true;
  }

  hasTransactions(): boolean {
    return this.current.size > 0;
  }

  getStack() {
    return this.stackTransaction;
  }

  getArrayLocks(): Array<string> {
    return [...this.current.keys()];
  }

  add(structLock: LockStruct): boolean {
    if (structLock.height !== this.heightCurrent || this.hasBlock()) {
      return false;
    }

    // valid Tx's
    let aTx = structLock.tx.filter((_tx) => {
      return this.server.getValidation().validateTx(structLock.height, _tx);
    });

    const hash: string = Util.hash([this.heightCurrent, aTx.reduce((s, t) => s + t.sig, '')].join());
    if (hash !== this.currentHash) {
      aTx = aTx.filter((_tx) => {
        return !this.current.has(_tx.origin);
      });
      if (!aTx.length) {
        return true;
      }
      aTx.forEach((tx: TransactionStruct) => {
        this.current.set(tx.origin, tx);
      });
      this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1));
      this.currentHash = Util.hash([this.heightCurrent, this.arrayTransaction.reduce((s, t) => s + t.sig, '')].join());
      this.stakeLock = this.server.getBlockchain().getStake(structLock.origin);
      this.mapVote = new Map();
      this.mapVote.set(structLock.origin, structLock.sig);
      this.roundLock = 0;
    } else if (!this.mapVote.has(structLock.origin)) {
      this.stakeLock += this.server.getBlockchain().getStake(structLock.origin);
      this.mapVote.set(structLock.origin, structLock.sig);
      if (this.stakeLock >= this.server.getBlockchain().getQuorum()) {
        //@FIXME hardcoded
        if (this.roundLock++ >= 2) {
          this.block = Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayTransaction);
          this.mapVote.forEach((sig, origin) => {
            this.block.votes.push({ origin: origin, sig: sig });
          });
        } else {
          this.stakeLock = 0;
          this.mapVote = new Map();
        }

        //@FIXME logging
        console.debug(`Round: ${this.roundLock} - ${this.currentHash}`);
      }
    }

    return true;
  }

  getBlock(): BlockStruct {
    return this.block.hash ? this.block : ({} as BlockStruct);
  }

  getLock(): Lock {
    return new Lock().create(
      this.roundLock,
      this.server.getWallet().getPublicKey(),
      this.heightCurrent,
      this.arrayTransaction,
      this.server.getWallet().sign(this.currentHash)
    );
  }

  hasBlock(): boolean {
    return !!this.block.hash;
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
    this.stakeLock = 0;
    this.roundLock = 0;
  }
}
