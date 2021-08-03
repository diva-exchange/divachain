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
import { BlockStruct } from '../../chain/block';
import { Validation } from '../validation';

export type VoteStruct = {
  origin: string;
  block: BlockStruct;
  sig: string;
};

export class Vote extends Message {
  constructor(message?: Buffer | string) {
    super(message);
    this.message.type = Message.TYPE_VOTE;
    this.message.broadcast = true;
  }

  create(structVote: VoteStruct): Vote {
    this.message.ident = this.message.type + structVote.sig;
    this.message.data = structVote;
    return this;
  }

  get(): VoteStruct {
    return this.message.data as VoteStruct;
  }

  static isValid(structVote: VoteStruct): boolean {
    return (
      Validation.validateBlock(structVote.block) &&
      Util.verifySignature(structVote.origin, structVote.sig, structVote.block.hash)
    );
  }
}
