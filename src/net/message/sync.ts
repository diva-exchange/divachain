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

export type SyncStruct = {
  type: number;
  seq: number;
  origin: string;
  block: BlockStruct;
  sig: string;
};

export class Sync extends Message {
  create(wallet: Wallet, block: BlockStruct): Sync {
    const seq = Date.now();
    this.message.data = {
      type: Message.TYPE_SYNC,
      seq: seq,
      origin: wallet.getPublicKey(),
      block: block,
      sig: wallet.sign([Message.TYPE_SYNC, seq, block.hash].join()),
    };
    return this;
  }

  get(): SyncStruct {
    return this.message.data as SyncStruct;
  }

  static isValid(structSync: SyncStruct): boolean {
    return Util.verifySignature(
      structSync.origin,
      structSync.sig,
      [structSync.type, structSync.seq, structSync.block.hash].join()
    );
  }
}
