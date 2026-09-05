/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import sodium from 'sodium-native';

export const MOCK_I2P_DEST = 'A'.repeat(688);
export const MOCK_VRF = 'vrf_proof_' + '0'.repeat(76);
export const MOCK_SIG = 'sig_proof_' + '0'.repeat(76);
export const MOCK_HASH = 'hash_' + '0'.repeat(38);
export const ZERO_HASH = '0'.repeat(43);
export const MOCK_PK = 'pk_' + '0'.repeat(40);

export function generateValidators(count = 31) {
  const validators = [];
  for (let i = 0; i < count; i++) {
    const num = String(i).padStart(2, '0');
    const pk = `validator_pk_${num}_` + '0'.repeat(27);
    validators.push({ pk, vrf: MOCK_VRF });
  }
  return validators;
}

function write16V(
  target: Uint8Array,
  offset: number,
  data: Uint8Array,
): number {
  const view = new DataView(
    target.buffer,
    target.byteOffset,
    target.byteLength,
  );
  view.setUint16(offset, data.length, true);
  target.set(data, offset + 2);
  return offset + 2 + data.length;
}

export function createDummyKeystore(
  pathKeystore: string,
  passphrase: string | Uint8Array,
) {
  const PK_SIZE = sodium.crypto_sign_PUBLICKEYBYTES;
  const SK_SIZE = sodium.crypto_sign_SECRETKEYBYTES;
  const enc = new TextEncoder();

  const nodePkBuf = sodium.sodium_malloc(PK_SIZE);
  const nodeSkBuf = sodium.sodium_malloc(SK_SIZE);
  sodium.crypto_sign_keypair(nodePkBuf, nodeSkBuf);

  const socPkBuf = sodium.sodium_malloc(PK_SIZE);
  const socSkBuf = sodium.sodium_malloc(SK_SIZE);
  sodium.crypto_sign_keypair(socPkBuf, socSkBuf);

  const decoyPkBuf = sodium.sodium_malloc(PK_SIZE);
  const decoySkBuf = sodium.sodium_malloc(SK_SIZE);
  sodium.crypto_sign_keypair(decoyPkBuf, decoySkBuf);

  const httpPubBuf = enc.encode(MOCK_I2P_DEST);
  const httpPrivBuf = Buffer.alloc(SK_SIZE, 0x01);
  const httpAddrBuf = enc.encode('http_addr.b32.i2p');

  const udpPubBuf = enc.encode(MOCK_I2P_DEST);
  const udpPrivBuf = Buffer.alloc(SK_SIZE, 0x02);
  const udpAddrBuf = enc.encode('udp_addr.b32.i2p');

  let totalSize = 1 + PK_SIZE + SK_SIZE;
  totalSize += 2 + httpPubBuf.length + 2 + httpPrivBuf.length + 2 +
    httpAddrBuf.length;
  totalSize += 2 + udpPubBuf.length + 2 + udpPrivBuf.length + 2 +
    udpAddrBuf.length;
  totalSize += 2 + (2 * (PK_SIZE + SK_SIZE));

  const payloadBuf = Buffer.alloc(totalSize);
  let offset = 0;

  payloadBuf[offset++] = 0x01; // Binary Version 0x01

  payloadBuf.set(nodePkBuf, offset);
  offset += PK_SIZE;
  payloadBuf.set(nodeSkBuf, offset);
  offset += SK_SIZE;

  offset = write16V(payloadBuf, offset, httpPubBuf);
  offset = write16V(payloadBuf, offset, httpPrivBuf);
  offset = write16V(payloadBuf, offset, httpAddrBuf);

  offset = write16V(payloadBuf, offset, udpPubBuf);
  offset = write16V(payloadBuf, offset, udpPrivBuf);
  offset = write16V(payloadBuf, offset, udpAddrBuf);

  const view = new DataView(
    payloadBuf.buffer,
    payloadBuf.byteOffset,
    payloadBuf.byteLength,
  );
  view.setUint16(offset, 2, true);
  offset += 2;

  payloadBuf.set(socPkBuf, offset);
  offset += PK_SIZE;
  payloadBuf.set(socSkBuf, offset);
  offset += SK_SIZE;

  payloadBuf.set(decoyPkBuf, offset);
  offset += PK_SIZE;
  payloadBuf.set(decoySkBuf, offset);
  offset += SK_SIZE;

  const passphraseBuf = typeof passphrase === 'string'
    ? createHash('sha256').update(passphrase).digest()
    : Buffer.from(passphrase);

  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES);
  sodium.randombytes_buf(salt);

  const encryptionKey = sodium.sodium_malloc(sodium.crypto_secretbox_KEYBYTES);
  sodium.crypto_pwhash(
    encryptionKey,
    passphraseBuf,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );

  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
  sodium.randombytes_buf(nonce);

  const cipherText = Buffer.alloc(
    payloadBuf.length + sodium.crypto_secretbox_MACBYTES,
  );
  sodium.crypto_secretbox_easy(cipherText, payloadBuf, nonce, encryptionKey);

  const fileData = Buffer.concat([salt, nonce, cipherText]);
  Deno.writeFileSync(pathKeystore, fileData, { mode: 0o600 });

  sodium.sodium_memzero(encryptionKey);
  sodium.sodium_memzero(nodeSkBuf);
  sodium.sodium_memzero(socSkBuf);
  sodium.sodium_memzero(decoySkBuf);
}
