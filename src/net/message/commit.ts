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
import { Logger } from '../../logger';
import { VoteStruct } from './vote';

export class Commit extends Message {
  constructor(message?: Buffer | string) {
    super(message);
  }

  create(commit: VoteStruct): Commit {
    this.message.type = Message.TYPE_COMMIT;
    this.message.ident = this.message.type + commit.origin + commit.block.hash;
    this.message.data = commit;
    this.message.broadcast = true;
    return this;
  }

  get(): VoteStruct {
    return this.message.data as VoteStruct;
  }

  static isValid(c: VoteStruct): boolean {
    try {
      let _a: Array<{ origin: string; sig: string }> = [];
      if (Util.verifySignature(c.origin, c.sig, c.block.hash + JSON.stringify(c.block.votes))) {
        _a = c.block.votes.filter((v) => Util.verifySignature(v.origin, v.sig, c.block.hash));
      }
      return _a.length === c.block.votes.length;
    } catch (error) {
      //@FIXME logging
      Logger.trace(`Commit.isValid Exception: ${error}`);
      return false;
    }
  }
}
