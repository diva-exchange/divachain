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

import { Transaction, TransactionStruct } from '../chain/transaction';
import { Wallet } from '../chain/wallet';
import { BlockStruct } from '../chain/block';

export class TransactionPool {
  private readonly wallet: Wallet;
  private readonly publicKey: string;

  private stackTransaction: Array<TransactionStruct> = [];
  private inTransit: TransactionStruct = {} as TransactionStruct;

  private current: Map<string, TransactionStruct> = new Map();

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    this.publicKey = this.wallet.getPublicKey();
  }

  stack(t: TransactionStruct): boolean {
    return t.origin === this.publicKey && Transaction.isValid(t) && this.stackTransaction.push(t) > 0;
  }

  getStack() {
    return this.stackTransaction;
  }

  release(): boolean {
    if (this.inTransit.timestamp) {
      return false;
    }
    this.inTransit = this.stackTransaction.shift() || ({} as TransactionStruct);
    return this.inTransit.timestamp > 0;
  }

  getInTransit() {
    return this.inTransit;
  }

  add(arrayT: Array<TransactionStruct>): boolean {
    let r = false;
    arrayT.forEach((t) => {
      // Per block (=round), each origin can only once add a TransactionStruct to the pool
      if (!this.current.has(t.origin) && Transaction.isValid(t)) {
        this.current.set(t.origin, t);
        r = true;
      }
    });
    return r;
  }

  get(): Array<TransactionStruct> {
    return Array.from(this.current.values());
  }

  clear(block: BlockStruct) {
    this.current = new Map();
    const hasTx = block.tx.some((t) => {
      return t.origin === this.inTransit.origin && t.sig === this.inTransit.sig;
    });
    if (!hasTx) {
      this.stackTransaction.unshift(this.inTransit);
    }
    this.inTransit = {} as TransactionStruct;
  }
}
