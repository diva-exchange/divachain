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

import { Util } from '../chain/util';
import { VoteStruct } from '../net/message/vote';
import { MIN_APPROVALS } from '../config';

export class VotePool {
  private list: Array<{ origin: string; sig: string }> = [];

  add(vote: VoteStruct) {
    !this.list.some((_v) => _v.origin === vote.origin) &&
      VotePool.isValid(vote) &&
      this.list.push({ origin: vote.origin, sig: vote.sig });
  }

  accepted(): boolean {
    return this.list.length >= MIN_APPROVALS;
  }

  get(): Array<{ origin: string; sig: string }> {
    return this.list.sort((a, b) => (a.origin > b.origin ? 1 : -1));
  }

  clear() {
    this.list = [];
  }

  private static isValid(vote: VoteStruct): boolean {
    try {
      return Util.verifySignature(vote.origin, vote.sig, vote.hash);
    } catch (error) {
      return false;
    }
  }
}
