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
import { Block } from '../blockchain/block';
import { Commit } from '../p2p/message/commit';
import { Logger } from '../logger';
import { Proposal } from '../p2p/message/proposal';
import sodium from 'sodium-native';
import { Transaction } from '../p2p/message/transaction';
import { Vote } from '../p2p/message/vote';

export class Wallet {
  publicKey: Buffer;
  secretKey: Buffer;

  /**
   * @param secret
   */
  constructor(secret: string) {
    const bufferSeed: Buffer = sodium.sodium_malloc(sodium.crypto_sign_SEEDBYTES);
    sodium.sodium_mlock(bufferSeed);
    bufferSeed.fill(secret);

    /** @type {Buffer} */
    this.publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
    /** @type {Buffer} */
    this.secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.sodium_mlock(this.secretKey);

    sodium.crypto_sign_seed_keypair(this.publicKey, this.secretKey, bufferSeed);
  }

  /**
   * @returns {string}
   */
  toString(): string {
    return `Wallet - publicKey: ${base64url.escape(this.publicKey.toString('base64'))}`;
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

  createTransaction(data: any): Transaction {
    return new Transaction().create({
      origin: this.getPublicKey(),
      transaction: data,
      signature: this.sign(JSON.stringify(data)),
    });
  }

  createProposal(block: Block): Proposal {
    return new Proposal().create({
      origin: this.getPublicKey(),
      block: block,
      signature: this.sign(JSON.stringify(block)),
    });
  }

  createVote(block: Block): Vote {
    Logger.trace(`createVote() for hash: ${block.hash}`);
    return new Vote().create({
      origin: this.getPublicKey(),
      hash: block.hash,
      signature: this.sign(block.hash),
    });
  }

  createCommit(block: Block): Vote {
    Logger.trace(`createCommit() for hash: ${block.hash}`);
    return new Commit().create({
      origin: this.getPublicKey(),
      hash: block.hash,
      signature: this.sign(block.hash),
    });
  }

  /**
   * @returns {string} - base64url encoded
   */
  getPublicKey(): string {
    return base64url.escape(this.publicKey.toString('base64'));
  }
}
