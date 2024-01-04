/**
 * Copyright (C) 2021-2024 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { iMessage, Message, TYPE_VOTE } from './message.js';
import { VoteStruct } from '../../chain/tx.js';

export type VoteMessageStruct = {
  hash: string;
  votes: Array<VoteStruct>;
};

interface iVoteMessage extends iMessage {
  hash(): string;
  votes(): Array<VoteStruct>;
}

export class VoteMessage extends Message implements iVoteMessage {
  constructor(struct: VoteMessageStruct, pkOrigin: string) {
    super(struct, TYPE_VOTE, pkOrigin);
  }

  hash(): string {
    return (this.message as VoteMessageStruct).hash;
  }
  votes(): Array<VoteStruct> {
    return (this.message as VoteMessageStruct).votes;
  }
}
