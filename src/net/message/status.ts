/**
 * Copyright (C) 2022 diva.exchange
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

import { Message } from './message';
import { Wallet } from '../../chain/wallet';

type StatusStruct = {
  type: number;
  status: number;
  height: number;
};

export const ONLINE = 1;
export const OFFLINE = 2;

export class Status extends Message {
  create(wallet: Wallet, status: number, height: number): Status {
    this.init(wallet.getPublicKey());
    this.message.data = {
      type: Message.TYPE_STATUS,
      status: status,
      height: height,
    } as StatusStruct;
    this.pack(wallet);
    return this;
  }

  status(): number {
    return this.message.data.status;
  }

  height(): number {
    return this.message.data.height;
  }
}
