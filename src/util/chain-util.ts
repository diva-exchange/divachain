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

import * as sodium from 'sodium-native';

export class ChainUtil {
  /**
   * @param s {string}
   * @returns {string}
   */
  static hash(s: string): string {
    const bufferOutput: Buffer = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES);
    sodium.crypto_hash_sha256(bufferOutput, Buffer.from(s));
    return bufferOutput.toString('base64');
  }

  /**
   * @param {string} publicKey - Hex formatted
   * @param {string} signature - Hex formatted
   * @param {string} data
   * @returns {boolean}
   */
  static verifySignature(publicKey: string, signature: string, data: string): boolean {
    return sodium.crypto_sign_verify_detached(
      Buffer.from(signature, 'base64'),
      Buffer.from(data),
      Buffer.from(publicKey, 'base64')
    );
  }
}
