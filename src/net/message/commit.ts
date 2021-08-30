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
    this.message.t = Message.TYPE_COMMIT;
    this.message.bc = true;
  }

  create(structVote: VoteStruct): Commit {
    this.message.ident = this.message.t + Util.md5hex(structVote.sig);
    this.message.dta = structVote;
    return this;
  }

  get(): VoteStruct {
    return this.message.dta as VoteStruct;
  }

  /**
   * Validate the signature of the Commit message, all the votes and the block itself
   *
   * @param {VoteStruct} structVote - Data structure to validate
   */
  static isValid(structVote: VoteStruct): boolean {
    if (!structVote.blc.vts.length) {
      return false;
    }

    let _a: Array<{ orgn: string; sig: string }> = [];
    if (
      Util.verifySignature(
        structVote.orgn,
        structVote.sig,
        Util.hash(structVote.blc.h + JSON.stringify(structVote.blc.vts))
      )
    ) {
      _a = structVote.blc.vts.filter((v) => Util.verifySignature(v.orgn, v.sig, structVote.blc.h));
    }

    return _a.length === structVote.blc.vts.length && Validation.validateBlock(structVote.blc);
  }
}
