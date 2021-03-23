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

import { ChainUtil } from '../blockchain/chain-util';
import { VoteStruct } from '../p2p/message/vote';
import { MIN_APPROVALS } from '../config';

export class VotePool {
  private list: Array<VoteStruct>;

  constructor() {
    this.list = [];
  }

  add(vote: VoteStruct): void {
    this.list.indexOf(vote) < 0 && VotePool.isValid(vote) && this.list.push(vote);
  }

  accepted(): boolean {
    return this.list.length >= MIN_APPROVALS;
  }

  get(): Array<VoteStruct> {
    return this.list;
  }

  clear() {
    this.list = [];
  }

  private static isValid(vote: VoteStruct): boolean {
    return ChainUtil.verifySignature(vote.origin, vote.signature, vote.hash);
  }
}
