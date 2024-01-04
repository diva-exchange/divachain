/**
 * Copyright (C) 2021-2024 diva.exchange
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

import { base64url } from 'rfc4648';
import sodium from 'sodium-native';
import { TxStruct } from './tx.js';

export class Util {
  static hash(tx: TxStruct): string {
    const bufferOutput: Buffer = Buffer.alloc(sodium.crypto_hash_sha256_BYTES);
    sodium.crypto_hash_sha256(
      bufferOutput,
      Buffer.from([tx.v, tx.height, tx.prev, tx.origin, JSON.stringify(tx.commands)].join(','))
    );
    return base64url.stringify(bufferOutput, { pad: false });
  }

  static verifySignature(publicKey: string, sig: string, data: string): boolean {
    try {
      return sodium.crypto_sign_verify_detached(
        base64url.parse(sig, { loose: true }) as Buffer,
        Buffer.from(data),
        base64url.parse(publicKey, { loose: true }) as Buffer
      );
    } catch (error: any) {
      return false;
    }
  }

  /**
   * Shuffle an array, using Durstenfeld shuffle
   * https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
   *
   * @param {Array<any>} array
   * @return {Array<any>} A copy of the array
   */
  static shuffleArray(array: Array<any>): Array<any> {
    const a: Array<any> = array.slice();
    for (let i: number = array.length - 1; i > 0; i--) {
      const j: number = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }

    return a;
  }

  /**
   * Calculate quartile coefficient of dispersion of an array of numbers
   * https://en.wikipedia.org/wiki/Quartile_coefficient_of_dispersion
   */
  static QuartileCoeff(array: Array<number>): number {
    if (array.length < 4) {
      throw new Error('Invalid Argument');
    }

    const as = array.sort((a, b) => a - b);
    const qi1 = as[Math.floor(array.length * 0.25)] - as[0];
    const qi3 = as[Math.floor(array.length * 0.75)] - as[0];
    return (qi3 - qi1) / (qi3 + qi1);
  }

  static stringDiff(a: string, b: string): number {
    if (!a.length || a.length !== b.length) {
      throw new Error('Invalid string input');
    }
    let r: number = 0;
    for (let i = 0; i < a.length; i++) {
      r += Math.abs(a.charCodeAt(i) - b.charCodeAt(i));
    }
    return r;
  }
}
