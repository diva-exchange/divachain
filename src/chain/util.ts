/**
 * Copyright (C) 2021-2025 diva.exchange
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

import { decodeBase64Url, encodeBase64Url } from '@std/encoding';
import sodium from 'sodium-native';
import { TxStruct } from './tx.ts';

export class Util {
  /**
   * Hash of a transaction (TxStruct)
   * @param tx TxStruct
   * @returns hash of a TxStruct
   */
  public static hash(tx: TxStruct): string {
    const bufferOutput: Uint8Array = new Uint8Array(
      sodium.crypto_hash_sha256_BYTES,
    );
    sodium.crypto_hash_sha256(
      bufferOutput,
      new TextEncoder().encode(
        [tx.v, tx.height, tx.prev, tx.origin, JSON.stringify(tx.commands)].join(
          ',',
        ),
      ),
    );
    return encodeBase64Url(bufferOutput);
  }

  public static verifySignature(
    publicKey: string,
    sig: string,
    data: string,
  ): boolean {
    try {
      return sodium.crypto_sign_verify_detached(
        decodeBase64Url(sig),
        new TextEncoder().encode(data),
        decodeBase64Url(publicKey),
      );
    } catch (_error) {
      return false;
    }
  }

  /**
   * Shuffle an array, using Durstenfeld shuffle
   * https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
   * @param {Array<string | number | Uint8Array>} array
   * @return {Array<string | number | Uint8Array>} A copy of the array
   */
  public static shuffleArray(
    array: Array<string | number | Uint8Array>,
  ): Array<string | number | Uint8Array> {
    const a: Array<string | number | Uint8Array> = array.slice();
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
  public static QuartileCoeff(array: Array<number>): number {
    if (array.length < 4) {
      throw new Error('Invalid Argument');
    }

    const as = array.sort((a, b) => a - b);
    const qi1 = as[Math.floor(array.length * 0.25)] - as[0];
    const qi3 = as[Math.floor(array.length * 0.75)] - as[0];
    return (qi3 - qi1) / (qi3 + qi1);
  }

  public static stringDiff(a: string, b: string): number {
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
