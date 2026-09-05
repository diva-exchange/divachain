/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { decodeBase64Url, encodeBase64Url } from '@std/encoding';
import sodium, { SecureBuffer } from 'sodium-native';
import { Buffer } from 'node:buffer';
import { crypto } from '@std/crypto/crypto';
import { ConsensusBlockStruct, SocBlockStruct } from './block.ts';
import { Economics } from './economics.ts';
import init, { grind_pow } from '../wasm/blake3_wasm.js';

export class Util {
  /**
   * Hash of a block (BlockStruct)
   * The 'ha' (hash) field itself is intentionally ignored in the calculation.
   * @param block BlockStruct
   * @returns hash of a BlockStruct
   */
  public static hash(
    b: SocBlockStruct | ConsensusBlockStruct,
  ): string {
    // Use standard heap memory (Buffer) to avoid memory leaks
    const bufferOutput: SecureBuffer = Buffer.alloc(
      sodium.crypto_hash_sha256_BYTES,
    ) as SecureBuffer;

    const dataStr: string = ('h' in b)
      ? [b.e, b.h, b.p, JSON.stringify(b.cs)].join(',')
      : [b.e, b.p, JSON.stringify(b.cs)].join(',');
    const dataBuffer: SecureBuffer = Buffer.from(dataStr) as SecureBuffer;

    sodium.crypto_hash_sha256(bufferOutput, dataBuffer);

    return encodeBase64Url(bufferOutput);
  }

  public static verifySignature(
    publicKey: string,
    sig: string,
    data: string,
  ): boolean {
    try {
      // Use Buffer to correctly cast Uint8Array to sodium-native's expected SecureBuffer
      const sigBuf: SecureBuffer = Buffer.from(
        decodeBase64Url(sig),
      ) as SecureBuffer;
      const dataBuf: SecureBuffer = Buffer.from(data) as SecureBuffer;
      const pubKeyBuf: SecureBuffer = Buffer.from(
        decodeBase64Url(publicKey),
      ) as SecureBuffer;

      return sodium.crypto_sign_verify_detached(
        sigBuf,
        dataBuf,
        pubKeyBuf,
      );
    } catch (_error: unknown) {
      return false;
    }
  }

  /**
   * Shuffle an array, using Durstenfeld shuffle
   * https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
   * @param {Array<string | number | Uint8Array>} array
   * @return {Array<string | number | Uint8Array>} A copy of the array
   */
  public static shuffleArray<T extends string | number | Uint8Array>(
    array: Array<T>,
  ): Array<T> {
    const a: Array<T> = array.slice();
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

    const as: Array<number> = array.sort((a, b) => a - b);
    const qi1: number = as[Math.floor(array.length * 0.25)] - as[0];
    const qi3: number = as[Math.floor(array.length * 0.75)] - as[0];
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

  /**
   * Calculates the XOR distance between two strings (e.g., Public Keys).
   * Used for deterministic Kademlia-like neighborhood selection.
   *
   * @param a First public key
   * @param b Second public key
   * @returns BigInt representing the absolute mathematical distance
   */
  public static xorDistance(a: string, b: string): bigint {
    const len = Math.max(a.length, b.length);
    let distance = 0n;
    for (let i = 0; i < len; i++) {
      const byteA = i < a.length ? a.charCodeAt(i) : 0;
      const byteB = i < b.length ? b.charCodeAt(i) : 0;
      distance = (distance << 8n) + BigInt(byteA ^ byteB);
    }
    return distance;
  }

  /**
   * Hashes a generic string using SHA-256 and returns a base64url encoded string.
   * @param data The string to hash
   * @returns A base64url encoded SHA-256 hash
   */
  public static hashString(data: string): string {
    const bufferOutput: SecureBuffer = Buffer.alloc(
      sodium.crypto_hash_sha256_BYTES,
    ) as SecureBuffer;

    const dataBuffer: SecureBuffer = Buffer.from(data) as SecureBuffer;
    sodium.crypto_hash_sha256(bufferOutput, dataBuffer);

    return encodeBase64Url(bufferOutput);
  }

  /**
   * Validates if a given string is a strictly formatted I2P Base32 address.
   */
  public static isI2pBase32Address(address: string): boolean {
    return /^[a-z2-7]{52}\.b32\.i2p$/.test(address);
  }

  /**
   * Asynchronous PoW verification for the Storage Committee using Deno's native BLAKE3.
   * Target: The first 2 bytes of the hash must be zero (Difficulty = 16 bits).
   */
  public static async verifyIdentityPoW(
    pubKey: string,
    nonce: string,
  ): Promise<boolean> {
    const data = new TextEncoder().encode(pubKey + nonce);
    const hashBuffer = await crypto.subtle.digest('BLAKE3', data);
    const hashArray = new Uint8Array(hashBuffer);

    const difficulty = Util.getIdentityPoWDifficulty();
    const bytesNeeded = Math.ceil(difficulty / 2);

    let hexString = '';
    for (let i = 0; i < bytesNeeded; i++) {
      hexString += hashArray[i].toString(16).padStart(2, '0');
    }

    return hexString.startsWith('0'.repeat(difficulty));
  }

  /**
   * CPU-Grinding for new SOC_KEY generation
   */
  public static async grindIdentityPoW(
    pubKey: string,
    difficulty: number = 2,
  ): Promise<string> {
    await init();
    return grind_pow(pubKey, difficulty);
  }

  /**
   * Returns the required number of leading zero hex characters.
   */
  public static getIdentityPoWDifficulty(): number {
    return Economics.IS_TESTNET ? 1 : 4;
  }
}
