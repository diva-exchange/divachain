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
import { Util } from '../chain/util';
import { Wallet } from '../chain/wallet';
import { Validation } from '../net/validation';

export class TransactionPool {
  private current: Array<TransactionStruct> = [];
  private next: TransactionStruct = {} as TransactionStruct;

  addOwn(t: TransactionStruct, wallet: Wallet): boolean {
    if (!TransactionPool.isValid(t)) {
      return false;
    }
    const _pk = wallet.getPublicKey();
    if (this.current.some((_t) => _t.origin === _pk)) {
      this.next = new Transaction(
        wallet,
        (this.next.commands || []).concat(t.commands),
        this.next.ident || t.ident
      ).get();
      t.ident = this.next.ident;
      t.timestamp = this.next.timestamp;
      t.commands = this.next.commands;
    } else {
      this.current.push(t);
    }
    return true;
  }

  add(arrayT: Array<TransactionStruct>): boolean {
    let r = false;
    arrayT.forEach((t) => {
      if (!this.current.some((_t) => _t.origin === t.origin) && TransactionPool.isValid(t)) {
        this.current.push(t);
        r = true;
      }
    });
    return r;
  }

  get(): Array<TransactionStruct> {
    return this.current;
  }

  clear() {
    this.current = this.next.timestamp ? [this.next] : [];
    this.next = {} as TransactionStruct;
  }

  private static isValid(t: TransactionStruct): boolean {
    try {
      return Validation.validateTx(t) && Util.verifySignature(t.origin, t.sig, JSON.stringify(t.commands));
    } catch (e) {
      return false;
    }
  }
}
