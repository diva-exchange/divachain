/**
 * Copyright (C) 2021 diva.exchange
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
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { ChainUtil } from '../util/chain-util';
import { Wallet } from '../transaction/wallet';

export interface MessageStruct {
  publicKey: string;
  message: string;
  signature: string;
  blockHash: string;
}

export class MessagePool {
  list: { [id: string]: Array<MessageStruct> };
  private readonly message: string;

  constructor() {
    this.list = {};
    this.message = 'INITIATE NEW ROUND';
  }

  createMessage(blockHash: string, wallet: Wallet): MessageStruct {
    return {
      publicKey: wallet.getPublicKey(),
      message: this.message,
      signature: wallet.sign(ChainUtil.hash(this.message + blockHash)),
      blockHash: blockHash,
    };
  }

  existingMessage(message: MessageStruct): boolean {
    return (
      !!this.list[message.blockHash] && !!this.list[message.blockHash].find((p) => p.publicKey === message.publicKey)
    );
  }

  static isValidMessage(message: MessageStruct): boolean {
    return ChainUtil.verifySignature(
      message.publicKey,
      message.signature,
      ChainUtil.hash(message.message + message.blockHash)
    );
  }

  addMessage(message: MessageStruct): void {
    this.list[message.blockHash]
      ? this.list[message.blockHash].push(message)
      : (this.list[message.blockHash] = [message]);
  }
}
