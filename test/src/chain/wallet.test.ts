/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import {
  assertEquals,
  assertExists,
  assertFalse,
  assertRejects,
  assertThrows,
} from '@std/assert';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import sodium from 'sodium-native';
import { Wallet } from '../../../src/chain/wallet.ts';
import { Config } from '../../../src/config.ts';
import { createDummyKeystore, MOCK_I2P_DEST } from '../../helpers/keystore.ts';
import { mockStdinRead } from '../../helpers/stdin.ts';

function createMockConfig(tempDir: string): Config {
  return {
    path_keystore: path.join(tempDir, 'keystore.enc'),
    i2p_sam_http: '127.0.0.1:7656',
    i2p_sam_udp: '127.0.0.1:7656',
    decoys: 1,
  } as Config;
}

function hashPass(str: string): Uint8Array {
  return createHash('sha256').update(str).digest();
}

Deno.test('Wallet - Stdin Passphrase Resolution & Intercept Edge Cases', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);

  // Scenario 1: stdin returns null (EOF)
  let restoreStdin = mockStdinRead(() => Promise.resolve(null));
  try {
    await assertRejects(
      async () => await Wallet.make(config),
      Error,
      'FATAL: No passphrase provided via stdin.',
    );
  } finally {
    restoreStdin();
  }

  // Scenario 2: stdin returns only newlines (\r\n)
  restoreStdin = mockStdinRead((buf) => {
    buf.set(new TextEncoder().encode('\r\n'));
    return Promise.resolve(2);
  });
  try {
    await assertRejects(
      async () => await Wallet.make(config),
      Error,
      'FATAL: Empty passphrase provided.',
    );
  } finally {
    restoreStdin();
  }

  // Scenario 3: stdin returns valid passphrase with trailing newline
  createDummyKeystore(config.path_keystore, 'stdin_passphrase');

  restoreStdin = mockStdinRead((buf) => {
    const pass = new TextEncoder().encode('stdin_passphrase\n');
    buf.set(pass);
    return Promise.resolve(pass.length);
  });
  try {
    const wallet = await Wallet.make(config);
    assertEquals(wallet.getHttpAddress(), MOCK_I2P_DEST);
    wallet.close();
  } finally {
    restoreStdin();
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test('Wallet - Non-existent Keystore Initialization Rules', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);
  const passBuf = hashPass('some_pass');

  await assertRejects(
    async () => await Wallet.make(config, passBuf, false),
    Error,
    'FATAL: Node not initialized. Start via terminal first.',
  );

  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test('Wallet - New Keystore Creation (allowCreation = true)', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = { ...createMockConfig(tempDir), decoys: 2 } as Config;
  const passBuf = hashPass('new_keystore_pass');

  const origSetupSam = (Wallet.prototype as unknown as Record<string, unknown>)[
    'setupSamDestination'
  ];
  (Wallet.prototype as unknown as Record<string, unknown>)[
    'setupSamDestination'
  ] = async () => {
    const priv = sodium.sodium_malloc(64);
    sodium.sodium_mlock(priv);
    return {
      public: 'mock_i2p_pub_key_base64',
      private: priv,
      address: 'mock_address.b32.i2p',
    };
  };

  try {
    const wallet = await Wallet.make(config, passBuf, true);
    assertEquals(wallet.isLocked(), false);
    assertEquals(wallet.getAllSocs().length, 3); // 1 primary + 2 decoys
    assertExists(wallet.getHttpAddress());
    assertExists(wallet.getUdpAddress());
    assertExists(wallet.getNodePublicKey());

    const httpPriv = wallet.getSamPrivateKey('http');
    const udpPriv = wallet.getSamPrivateKey('udp');
    assertExists(httpPriv);
    assertExists(udpPriv);
    sodium.sodium_munlock(httpPriv);
    sodium.sodium_munlock(udpPriv);

    wallet.close();
  } finally {
    (Wallet.prototype as unknown as Record<string, unknown>)[
      'setupSamDestination'
    ] = origSetupSam;
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test('Wallet - Decryption Failures & Corrupt Keystore Binary Validation', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);
  const passBuf = hashPass('correct_passphrase');

  // 1. File too small
  Deno.writeFileSync(config.path_keystore, new Uint8Array([1, 2, 3]));
  await assertRejects(
    async () => await Wallet.make(config, passBuf),
    Error,
    'FATAL: Keystore file is too small or improperly formatted.',
  );

  // 2. Wrong Passphrase Decryption Error
  createDummyKeystore(config.path_keystore, 'correct_passphrase');
  const wrongPassBuf = hashPass('wrong_passphrase');
  await assertRejects(
    async () => await Wallet.make(config, wrongPassBuf),
    Error,
    'FATAL: Keystore decryption failed. Wrong passphrase or corrupt file.',
  );

  // 3. Unsupported Binary Version Byte (0x02 instead of 0x01)
  const saltBytes = sodium.crypto_pwhash_SALTBYTES;
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
  const salt = Buffer.alloc(saltBytes);
  const nonce = Buffer.alloc(nonceBytes);
  sodium.randombytes_buf(salt);
  sodium.randombytes_buf(nonce);

  const encKey = sodium.sodium_malloc(sodium.crypto_secretbox_KEYBYTES);
  sodium.crypto_pwhash(
    encKey,
    Buffer.from(passBuf),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );

  const invalidPayload = Buffer.from([0x02, 0, 0, 0]);
  const cipherText = Buffer.alloc(
    invalidPayload.length + sodium.crypto_secretbox_MACBYTES,
  );
  sodium.crypto_secretbox_easy(cipherText, invalidPayload, nonce, encKey);
  sodium.sodium_memzero(encKey);

  const corruptFile = Buffer.concat([salt, nonce, cipherText]);
  Deno.writeFileSync(config.path_keystore, corruptFile);

  await assertRejects(
    async () => await Wallet.make(config, passBuf),
    Error,
    'FATAL: Unsupported keystore binary version.',
  );

  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test('Wallet - Session Token & Lock API Operations', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);
  const passBuf = hashPass('secret_passphrase');
  createDummyKeystore(config.path_keystore, 'secret_passphrase');

  const wallet = await Wallet.make(config, passBuf);
  const token = wallet.getTokenAPI();
  assertExists(token);

  assertEquals(wallet.validateTokenAndSlide(token), true);
  assertEquals(wallet.validateTokenAndSlide('invalid_token_string'), false);

  (wallet as unknown as Record<string, unknown>)['tokenExpiresAt'] =
    Date.now() - 1000;
  assertEquals(wallet.validateTokenAndSlide(token), false);
  assertEquals(wallet.isLocked(), true);

  assertThrows(
    () => wallet.requestVolatileIdentity(),
    Error,
    'FATAL: Wallet is locked.',
  );

  wallet.close();
  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test('Wallet - Volatile Identity Lifecycle & Keystore Persistence', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);
  const passBuf = hashPass('secret_passphrase');
  createDummyKeystore(config.path_keystore, 'secret_passphrase');

  const wallet = await Wallet.make(config, passBuf);

  const volPk = wallet.requestVolatileIdentity();
  assertExists(volPk);

  assertThrows(
    () => wallet.finalizeVolatileIdentity('unknown_pk_string'),
    Error,
    'FATAL: Identity expired or invalid.',
  );

  wallet.finalizeVolatileIdentity(volPk);
  const socs = wallet.getAllSocs().map((s) => s.publicKey);
  assertEquals(socs.includes(volPk), true);

  const bakPath = `${config.path_keystore}.bak`;
  assertEquals(Deno.statSync(bakPath).isFile, true);

  wallet.close();

  assertThrows(() => wallet.getAllSocs(), Error, 'FATAL: Wallet not opened.');
  assertThrows(() => wallet.getPublicKey(), Error, 'FATAL: Wallet not opened.');
  assertThrows(
    () => wallet.getNodePublicKey(),
    Error,
    'FATAL: Wallet not opened.',
  );
  assertThrows(
    () => wallet.getI2pPublicKeys(),
    Error,
    'FATAL: Wallet not opened.',
  );
  assertThrows(
    () => wallet.getSamPrivateKey('http'),
    Error,
    'FATAL: Wallet not opened.',
  );

  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test('Wallet - Cryptographic Signatures & VRF Detached Execution', async () => {
  const tempDir = Deno.makeTempDirSync();
  const config = createMockConfig(tempDir);
  const passBuf = hashPass('secret_passphrase');
  createDummyKeystore(config.path_keystore, 'secret_passphrase');

  const wallet = await Wallet.make(config, passBuf);

  const sigPrimary = wallet.sign('message_payload_data');
  assertExists(sigPrimary);

  const vrfPrimary = wallet.vrf('vrf_seed_string');
  assertEquals(vrfPrimary.length > 0, true);

  const sigNode = wallet.signNode('message_node_payload');
  assertExists(sigNode);

  const vrfNode = wallet.vrfNode('vrf_node_seed');
  assertEquals(vrfNode.length > 0, true);

  assertThrows(
    () => wallet.sign('data', 'unknown_origin_pk'),
    Error,
    'FATAL: No secret key available for SOC unknown_origin_pk',
  );

  wallet.close();
  Deno.removeSync(tempDir, { recursive: true });
});
