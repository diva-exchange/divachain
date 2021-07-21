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
import { VoteStruct } from './vote';
import { Validation } from '../validation';

export class Commit extends Message {
  constructor(message?: Buffer | string) {
    super(message);
  }

  create(structVote: VoteStruct): Commit {
    this.message.type = Message.TYPE_COMMIT;
    this.message.ident = this.message.type + structVote.origin + structVote.block.hash;
    this.message.data = structVote;
    this.message.broadcast = true;
    return this;
  }

  get(): VoteStruct {
    return this.message.data as VoteStruct;
  }

  /**
   * Validate the hash and all the votes of a block
   *
   * @param {VoteStruct} structVote - Data structure to validate
   */
  static isValid(structVote: VoteStruct): boolean {
    if (!structVote.block.votes.length) {
      return false;
    }

    let _a: Array<{ origin: string; sig: string }> = [];
    if (
      Util.verifySignature(
        structVote.origin,
        structVote.sig,
        structVote.block.hash + JSON.stringify(structVote.block.votes)
      )
    ) {
      _a = structVote.block.votes.filter((v) => Util.verifySignature(v.origin, v.sig, structVote.block.hash));
    }

    return _a.length === structVote.block.votes.length && Validation.validateBlock(structVote.block);
  }
}
