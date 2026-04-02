/**
 * Copyright (C) 2026 diva.exchange
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

import { iMessage, Message, TYPE_REMOVE_PEER } from './message.ts';

export type RemovePeerMessageStruct = {
  pk: string;
};

interface iRemovePeer extends iMessage {
  pk(): string;
}

export class RemovePeerMessage extends Message implements iRemovePeer {
  constructor(struct: RemovePeerMessageStruct, pkOrigin: string) {
    super(struct, TYPE_REMOVE_PEER, pkOrigin);
  }

  public pk(): string {
    return (this.message as RemovePeerMessageStruct).pk;
  }
}
