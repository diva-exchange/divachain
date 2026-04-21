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

import { iMessage, Message, TYPE_ADD_PEER } from './message.ts';

export type AddPeerMessageStruct = {
  http: string;
  udp: string;
  pk: string;
};

interface iAddPeer extends iMessage {
  http(): string;
  udp(): string;
  pk(): string;
}

export class AddPeerMessage extends Message implements iAddPeer {
  constructor(struct: AddPeerMessageStruct, pkOrigin: string) {
    super(struct, TYPE_ADD_PEER, pkOrigin);
  }

  public http(): string {
    return (this.message as AddPeerMessageStruct).http;
  }

  public udp(): string {
    return (this.message as AddPeerMessageStruct).udp;
  }

  public pk(): string {
    return (this.message as AddPeerMessageStruct).pk;
  }
}
