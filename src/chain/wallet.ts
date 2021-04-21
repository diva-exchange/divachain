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
import sodium from 'sodium-native';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { Config } from '../config';

export class Wallet {
  private readonly publicKey: Buffer;
  private readonly secretKey: Buffer;

  constructor(config: Config) {
    const pathSeed = path.join(
      config.path_state,
      (config.p2p_ip + '_' + config.p2p_port).replace(/[^0-9_]/g, '-') + '.seed'
    );
    // look for the seed file
    if (!fs.existsSync(pathSeed)) {
      fs.writeFileSync(pathSeed, nanoid(sodium.crypto_sign_SEEDBYTES));
      fs.chmodSync(pathSeed, '0600');
    }

    const bufferSeed: Buffer = sodium.sodium_malloc(sodium.crypto_sign_SEEDBYTES);
    sodium.sodium_mlock(bufferSeed);
    bufferSeed.fill(fs.readFileSync(pathSeed).toString());

    /** @type {Buffer} */
    this.publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
    /** @type {Buffer} */
    this.secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.sodium_mlock(this.secretKey);

    sodium.crypto_sign_seed_keypair(this.publicKey, this.secretKey, bufferSeed);

    sodium.sodium_munlock(bufferSeed);
  }

  close() {
    sodium.sodium_munlock(this.secretKey);
  }

  /**
   * @param data {string}
   * @returns {string} - base64url encoded signature
   */
  sign(data: string): string {
    const bufferSignature: Buffer = sodium.sodium_malloc(sodium.crypto_sign_BYTES);
    const bufferDataHash: Buffer = Buffer.from(data);

    sodium.crypto_sign_detached(bufferSignature, bufferDataHash, this.secretKey);

    return base64url.escape(bufferSignature.toString('base64'));
  }

  /**
   * @returns {string} - base64url encoded
   */
  getPublicKey(): string {
    return base64url.escape(this.publicKey.toString('base64'));
  }
}
