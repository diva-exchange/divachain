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

import { Message } from './message';
import { Util } from '../../chain/util';
import { TransactionStruct } from '../../chain/transaction';

export type LockStruct = {
  type: number;
  origin: string;
  height: number;
  tx: Array<TransactionStruct>;
  sig: string;
};

export class Lock extends Message {
  create(round: number, origin: string, height: number, tx: Array<TransactionStruct>, sig: string): Lock {
    const structLock: LockStruct = {
      type: Lock.TYPE_LOCK,
      origin: origin,
      height: height,
      tx: tx,
      sig: sig,
    };
    this.message.ident = [structLock.type, round, sig].join();
    this.message.data = structLock;
    return this;
  }

  get(): LockStruct {
    return this.message.data as LockStruct;
  }

  // stateful
  static isValid(structLock: LockStruct): boolean {
    return Util.verifySignature(
      structLock.origin,
      structLock.sig,
      Util.hash([structLock.height, structLock.tx.reduce((s, t) => s + t.sig, '')].join())
    );
  }
}
