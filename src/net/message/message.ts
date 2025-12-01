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

import { encodeBase64Url } from '@std/encoding';
import { TxMessageStruct } from './tx.ts';
import { VoteMessageStruct } from './vote.ts';
import { StatusMessageStruct } from './status.ts';
import { Wallet } from '../../chain/wallet.ts';

export const TYPE_TX = 1;
export const TYPE_VOTE = 2;
export const TYPE_STATUS = 3;

export interface iMessage {
  getOrigin(): string;
  asString(wallet: Wallet): string;
}

export class Message {
  protected readonly type: number;
  protected readonly origin: string;
  protected readonly message:
    | TxMessageStruct
    | VoteMessageStruct
    | StatusMessageStruct;

  constructor(
    struct: TxMessageStruct | VoteMessageStruct | StatusMessageStruct,
    type: number,
    origin: string,
  ) {
    this.type = type;
    this.origin = origin;
    this.message = struct;
  }

  getOrigin(): string {
    return this.origin;
  }

  asString(wallet: Wallet): string {
    const b64: string = encodeBase64Url(JSON.stringify(this.message));
    const pl: string = [this.type, b64].join(''); // payload
    return wallet.getPublicKey() + wallet.sign(pl) + pl + ';';
  }
}
