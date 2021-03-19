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

import { ChainUtil } from '../util/chain-util';
import { VoteStruct } from '../p2p/message/vote';
import { Logger } from '../logger';

export class VotePool {
  list: { [id: string]: Array<VoteStruct> };

  constructor() {
    this.list = {};
  }

  add(vote: VoteStruct): void {
    this.list[vote.hash] ? this.list[vote.hash].push(vote) : (this.list[vote.hash] = [vote]);
  }

  exists(vote: VoteStruct): boolean {
    return this.list[vote.hash] && !!this.list[vote.hash].find((p) => p.origin === vote.origin);
  }

  static isValid(vote: VoteStruct): boolean {
    //@FIXME logging
    Logger.trace(`VotePool.isValid: ${ChainUtil.verifySignature(vote.origin, vote.signature, vote.hash)}`);
    return ChainUtil.verifySignature(vote.origin, vote.signature, vote.hash);
  }
}
