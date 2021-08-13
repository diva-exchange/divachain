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

import { TransactionStruct } from '../chain/transaction';
import { Wallet } from '../chain/wallet';
import { BlockStruct } from '../chain/block';
import { Validation } from '../net/validation';

//@FIXME configurable? - not really - it's a protocol thing -> is the constant in the right place?
export const MAX_TRANSACTIONS = 8;

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
    return t.origin === this.publicKey && Validation.validateTx(t) && this.stackTransaction.push(t) > 0;
  }

  getStack() {
    return this.stackTransaction;
  }

  release(): boolean {
    if (this.inTransit.ident) {
      return false;
    }
    if (!this.stackTransaction.length) {
      return false;
    }

    this.inTransit = this.stackTransaction.shift() as TransactionStruct;
    this.current.set(this.publicKey, this.inTransit);
    return true;
  }

  add(arrayTx: Array<TransactionStruct>): boolean {
    const _s = this.current.size;
    arrayTx.forEach((tx) => {
      if (!this.current.has(tx.origin) && Validation.validateTx(tx)) {
        this.current.set(tx.origin, tx);
      }
    });
    return _s < this.current.size;
  }

  get(): Array<TransactionStruct> {
    //@FIXME sort algo
    return [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1)).slice(0, MAX_TRANSACTIONS);
  }

  clear(block: BlockStruct) {
    if (this.inTransit.ident) {
      const hasTx = block.tx.some((t) => {
        return t.sig === this.inTransit.sig;
      });
      if (!hasTx) {
        this.stackTransaction.unshift(this.inTransit);
      }
      this.inTransit = {} as TransactionStruct;
    }
    this.current = new Map();
  }
}
