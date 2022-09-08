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
  type: number;
  seq: number;
  origin: string;
  height: number;
  txlength: number;
  hash: string;
  sig: string;
  sigMsg: string;
};

export class Vote extends Message {
  create(wallet: Wallet, height: number, txlength: number, hash: string): Vote {
    const seq: number = Date.now();
    this.message.data = {
      type: Message.TYPE_VOTE,
      seq: seq,
      origin: wallet.getPublicKey(),
      height: height,
      txlength: txlength,
      hash: hash,
      sig: wallet.sign([height, hash].join()),
      sigMsg: wallet.sign([Message.TYPE_VOTE, seq, height, txlength, hash].join()),
    };
    return this;
  }

  get(): VoteStruct {
    return this.message.data as VoteStruct;
  }

  // stateful
  static isValid(structVote: VoteStruct): boolean {
    return Util.verifySignature(
      structVote.origin,
      structVote.sigMsg,
      [structVote.type, structVote.seq, structVote.height, structVote.txlength, structVote.hash].join()
    );
  }
}
