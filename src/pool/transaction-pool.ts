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

import { TransactionStruct } from '../net/message/transaction';
import { Util } from '../chain/util';

export class TransactionPool {
  private list: Array<TransactionStruct>;

  constructor() {
    this.list = [];
  }

  add(t: TransactionStruct) {
    if (this.list.indexOf(t) < 0 && TransactionPool.isValid(t)) {
      this.list.push(t);
    }
  }

  get(): TransactionStruct {
    return this.list[0] || {};
  }

  clear() {
    this.list = [];
  }

  private static isValid(t: TransactionStruct): boolean {
    try {
      return Util.verifySignature(t.origin, t.sig, JSON.stringify(t.commands));
    } catch (e) {
      return false;
    }
  }
}
