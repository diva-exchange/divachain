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

export type VoteStruct = {
  origin: string;
  sig: string;
};

type ConfirmBlockStruct = {
  type: number;
  hash: string;
  votes: Array<VoteStruct>;
};

export class ConfirmBlock extends Message {
  create(wallet: Wallet, hash: string, votes: Array<VoteStruct>): ConfirmBlock {
    this.init(wallet.getPublicKey());
    this.message.data = {
      type: Message.TYPE_CONFIRM_BLOCK,
      hash: hash,
      votes: votes,
    } as ConfirmBlockStruct;
    this.message.sig = wallet.sign([Message.TYPE_CONFIRM_BLOCK, this.message.seq, hash, JSON.stringify(votes)].join());
    return this;
  }

  hash(): string {
    return this.message.data.hash;
  }

  votes(): Array<VoteStruct> {
    return this.message.data.votes;
  }

  static isValid(confirmBlock: ConfirmBlock): boolean {
    return Util.verifySignature(
      confirmBlock.origin(),
      confirmBlock.sig(),
      [confirmBlock.type(), confirmBlock.seq(), confirmBlock.hash(), JSON.stringify(confirmBlock.votes())].join()
    );
  }
}
