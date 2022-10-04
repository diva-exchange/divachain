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
import { Util } from '../../chain/util';
import { Wallet } from '../../chain/wallet';
import { BlockStruct } from '../../chain/block';

type SyncStruct = {
  type: number;
  block: BlockStruct;
};

export class Sync extends Message {
  create(wallet: Wallet, block: BlockStruct): Sync {
    this.init(wallet.getPublicKey());
    this.message.data = {
      type: Message.TYPE_SYNC,
      block: block,
    } as SyncStruct;
    this.message.sig = wallet.sign([Message.TYPE_SYNC, this.message.seq, block.hash].join());
    return this;
  }

  block(): BlockStruct {
    return this.message.data.block;
  }

  static isValid(sync: Sync): boolean {
    return Util.verifySignature(sync.origin(), sync.sig(), [sync.type(), sync.seq(), sync.block().hash].join());
  }
}
