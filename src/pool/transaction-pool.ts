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

import { TransactionStruct } from '../p2p/message/transaction';
import { TRANSACTION_THRESHOLD } from '../config';
import { ChainUtil } from '../util/chain-util';

export class TransactionPool {
  transactions: Array<TransactionStruct>;

  constructor() {
    this.transactions = [];
  }

  add(t: TransactionStruct): boolean {
    this.transactions.push(t);
    return this.transactions.length >= TRANSACTION_THRESHOLD;
  }

  exists(t: TransactionStruct): boolean {
    return !!this.transactions.find((_t) => _t.id === t.id);
  }

  clear(): void {
    this.transactions = [];
  }

  static verify(t: TransactionStruct): boolean {
    return ChainUtil.verifySignature(t.publicKey, t.signature, t.id + JSON.stringify(t.input));
  }
}
