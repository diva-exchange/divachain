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
import { TransactionStruct } from '../../chain/transaction';
import { Wallet } from '../../chain/wallet';

type AddTxStruct = {
  type: number;
  height: number;
  tx: TransactionStruct;
};

export class AddTx extends Message {
  create(wallet: Wallet, dest: string, height: number, tx: TransactionStruct): AddTx {
    this.init(wallet.getPublicKey(), dest);
    this.message.data = {
      type: Message.TYPE_ADD_TX,
      height: height,
      tx: tx,
    } as AddTxStruct;
    this.pack(wallet);
    return this;
  }

  height(): number {
    return this.message.data.height;
  }

  tx(): TransactionStruct {
    return this.message.data.tx;
  }
}
