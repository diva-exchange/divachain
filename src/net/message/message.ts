/**
 * Copyright (C) 2021-2026 diva.exchange
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

import { TxMessageStruct } from './tx.ts';
import { StatusMessageStruct } from './status.ts';
import { AddPeerMessageStruct } from './add-peer.ts';
import { RemovePeerMessageStruct } from './remove-peer.ts';
import { Wallet } from '../../chain/wallet.ts';

export const TYPE_TX = 1;
export const TYPE_ADD_PEER = 5;
export const TYPE_REMOVE_PEER = 6;
export const TYPE_STATUS = 9;

export interface iMessage {
  getOrigin(): string;
  asString(wallet: Wallet): string;
}

export class Message {
  protected readonly type: number;
  protected readonly origin: string;
  protected readonly message:
    | TxMessageStruct
    | AddPeerMessageStruct
    | RemovePeerMessageStruct
    | StatusMessageStruct;

  constructor(
    struct:
      | TxMessageStruct
      | AddPeerMessageStruct
      | RemovePeerMessageStruct
      | StatusMessageStruct,
    type: number,
    origin: string,
  ) {
    this.type = type;
    this.origin = origin;
    this.message = struct;
  }

  public getMessage():
    | TxMessageStruct
    | AddPeerMessageStruct
    | RemovePeerMessageStruct
    | StatusMessageStruct {
    return this.message;
  }

  public getOrigin(): string {
    return this.origin;
  }

  public asString(wallet: Wallet): string {
    const data: string = JSON.stringify(this.message);
    const pl: string = this.type + data; // payload
    return wallet.getPublicKey() + wallet.sign(pl) + pl;
  }
}
