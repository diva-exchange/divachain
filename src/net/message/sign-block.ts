/**
 * Copyright (C) 2021-2022 diva.exchange
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

type SignBlockStruct = {
  type: number;
  hash: string;
  sig: string;
};

export class SignBlock extends Message {
  create(wallet: Wallet, dest: string, hash: string): SignBlock {
    this.init(wallet.getPublicKey(), dest);
    this.message.data = {
      type: Message.TYPE_SIGN_BLOCK,
      hash: hash,
      sig: wallet.sign(hash),
    } as SignBlockStruct;
    this.pack(wallet);
    return this;
  }

  hash(): string {
    return this.message.data.hash;
  }

  sig(): string {
    return this.message.data.sig;
  }
}
