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

import base64url from 'base64-url';
import { Message } from './message';
import sodium from 'sodium-native';

export class Auth extends Message {
  constructor(message?: Buffer | string) {
    super(message);
  }

  create(challenge: string, secretKey: Buffer): Auth {
    const bufferSignature: Buffer = sodium.sodium_malloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(bufferSignature, Buffer.from(challenge), secretKey);

    this.message.type = Message.TYPE_AUTH;
    this.message.data = base64url.escape(bufferSignature.toString('base64'));
    return this;
  }

  verify(challenge: string, publicKey: string): boolean {
    return (
      this.message.type === Message.TYPE_AUTH &&
      sodium.crypto_sign_verify_detached(
        Buffer.from(base64url.unescape(this.message.data), 'base64'),
        Buffer.from(challenge),
        Buffer.from(base64url.unescape(publicKey), 'base64')
      )
    );
  }
}
