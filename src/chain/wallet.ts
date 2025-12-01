/**
 * Copyright (C) 2021-2026 diva.exchange
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

import { encodeBase64Url } from '@std/encoding';
import { existsSync } from '@std/fs';
import sodium from 'sodium-native';
import path from 'node:path';
import { Config } from '../config.ts';
import { toB32 } from '@i2p/sam';
import { nanoid } from 'nanoid';
import { randomInt } from 'node:crypto';

export const NAME_HEADER_TOKEN_API = 'diva-token-api';
const DEFAULT_LENGTH_TOKEN_API = 32;

export class Wallet {
  private config: Config;
  private ident: string = '';
  private publicKey: Uint8Array;
  private secretKey: Uint8Array;
  private tokenAPI: string = '';

  static make(config: Config): Wallet {
    return new Wallet(config);
  }

  private constructor(config: Config) {
    this.config = config;
    this.publicKey = new Uint8Array(sodium.crypto_sign_PUBLICKEYBYTES);
    this.secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
    this.createTokenAPI();
  }

  private createTokenAPI() {
    const p: string = path.join(
      this.config.path_keys,
      toB32(this.config.http) + '.token',
    );
    Deno.writeFileSync(
      p,
      new TextEncoder().encode(nanoid(DEFAULT_LENGTH_TOKEN_API)),
      { mode: 0o600 },
    );
    this.tokenAPI = new TextDecoder().decode(Deno.readFileSync(p));
    setTimeout(
      () => {
        this.createTokenAPI();
      },
      randomInt(180000, 600000),
    ); // between 3 and 10 minutes
  }

  public getTokenAPI(): string {
    return this.tokenAPI;
  }

  private open(): Wallet {
    this.ident = toB32(this.config.http) + '.wallet';

    sodium.sodium_mlock(this.secretKey);

    // look for keys
    const pathPublic: string = path.join(
      this.config.path_keys,
      this.ident + '.public',
    );
    const pathSecret: string = path.join(
      this.config.path_keys,
      this.ident + '.private',
    );
    if (existsSync(pathPublic) && existsSync(pathSecret)) {
      this.publicKey = Deno.readFileSync(pathPublic);
      this.secretKey = Deno.readFileSync(pathSecret);
    } else {
      sodium.crypto_sign_keypair(this.publicKey, this.secretKey);

      Deno.writeFileSync(pathPublic, this.publicKey, { mode: 0o644 });
      Deno.writeFileSync(pathSecret, this.secretKey, { mode: 0o600 });
    }

    return this;
  }

  public close(): void {
    sodium.sodium_munlock(this.secretKey);
  }

  public sign(data: string): string {
    if (!this.ident) {
      this.open();
    }

    const bufferSignature: Uint8Array = new Uint8Array(
      sodium.crypto_sign_BYTES,
    );
    sodium.crypto_sign_detached(
      bufferSignature,
      new TextEncoder().encode(data),
      this.secretKey,
    );

    return encodeBase64Url(bufferSignature);
  }

  /**
   * Get the public key of the wallet
   * @returns string base64url encoded public key
   */
  public getPublicKey(): string {
    if (!this.ident) {
      this.open();
    }
    return encodeBase64Url(this.publicKey);
  }
}
