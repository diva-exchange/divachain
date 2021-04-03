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
  private readonly list: { [hash: string]: Array<{ origin: string; sig: string }> } = {};

  add(vote: VoteStruct): boolean {
    !this.list[vote.hash] && (this.list[vote.hash] = []);
    return (
      !this.list[vote.hash].some((_v) => _v.origin === vote.origin) &&
      VotePool.isValid(vote) &&
      this.list[vote.hash].push({ origin: vote.origin, sig: vote.sig }) > 0
    );
  }

  accepted(hash: string): boolean {
    return this.list[hash] && this.list[hash].length >= MIN_APPROVALS;
  }

  get(hash: string): Array<{ origin: string; sig: string }> {
    return this.list[hash];
  }

  getList(): { [hash: string]: Array<{ origin: string; sig: string }> } {
    return this.list;
  }

  clear(hash: string) {
    delete this.list[hash];
  }

  private static isValid(vote: VoteStruct): boolean {
    return Util.verifySignature(vote.origin, vote.sig, vote.hash);
  }
}
