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

type SignBlockStruct = {
  type: number;
  hash: string;
  sigBlock: string;
};

export class SignBlock extends Message {
  create(wallet: Wallet, dest: string, hash: string): SignBlock {
    this.init(wallet.getPublicKey(), dest);
    this.message.data = {
      type: Message.TYPE_SIGN_BLOCK,
      hash: hash,
      sigBlock: wallet.sign(hash),
    } as SignBlockStruct;
    this.message.sig = wallet.sign([Message.TYPE_SIGN_BLOCK, this.message.seq, hash].join());
    return this;
  }

  hash(): string {
    return this.message.data.hash;
  }

  sigBlock(): string {
    return this.message.data.sigBlock;
  }

  static isValid(signBlock: SignBlock): boolean {
    return Util.verifySignature(
      signBlock.origin(),
      signBlock.sig(),
      [signBlock.type(), signBlock.seq(), signBlock.hash()].join()
    );
  }
}
