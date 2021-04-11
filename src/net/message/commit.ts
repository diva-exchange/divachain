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
import { MIN_APPROVALS } from '../../config';
import { BlockStruct } from '../../chain/block';

export type CommitStruct = {
  origin: string;
  block: BlockStruct;
  votes: Array<{ origin: string; sig: string }>;
  sig: string;
};

export class Commit extends Message {
  constructor(message?: Buffer | string) {
    super(message);
  }

  create(commit: CommitStruct): Commit {
    this.message.type = Message.TYPE_COMMIT;
    this.message.ident = this.message.type + commit.block.hash;
    this.message.data = commit;
    this.message.broadcast = true;
    return this;
  }

  get(): CommitStruct {
    return this.message.data as CommitStruct;
  }

  static isValid(c: CommitStruct): boolean {
    try {
      return (
        c.votes.length >= MIN_APPROVALS && Util.verifySignature(c.origin, c.sig, c.block.hash + JSON.stringify(c.votes))
      );
    } catch (error) {
      return false;
    }
  }
}
