/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertNotEquals, assertThrows } from '@std/assert';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Util } from '../../../src/chain/util.ts';
import { Wallet } from '../../../src/chain/wallet.ts';
import { Config } from '../../../src/config.ts';
import { COMMAND_DATA, SocBlockStruct } from '../../../src/chain/block.ts';
import { createDummyKeystore } from '../../helpers/keystore.ts';

const ZERO_HASH = '0000000000000000000000000000000000000000000'; // 43 chars

Deno.test('Util - xorDistance() - Reflexivity (Distance to self must be 0)', () => {
  const pk = '8f3e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b';
  assertEquals(Util.xorDistance(pk, pk), 0n);
});

Deno.test('Util - xorDistance() - Symmetry (A -> B must equal B -> A)', () => {
  const pkA = 'nodeA_1234567890abcdefghijklmnopqrstuvwxyz0123';
  const pkB = 'nodeB_9876543210fedcba0987654321zyxwvutsrqponm';

  const distAB = Util.xorDistance(pkA, pkB);
  const distBA = Util.xorDistance(pkB, pkA);

  assertEquals(distAB, distBA);
  assertNotEquals(distAB, 0n);
});

Deno.test('Util - xorDistance() - Exact bitwise calculation', () => {
  assertEquals(Util.xorDistance('A', 'B'), 3n);
  assertEquals(Util.xorDistance('AB', 'AA'), 3n);
});

Deno.test('Util - xorDistance() - Neighborhood ordering logic', () => {
  const origin = 'target_node_public_key_12345';
  const closeNeighbor = 'target_node_public_key_12346';
  const farNeighbor = 'ZZZZZZ_node_public_key_12345';

  const distClose = Util.xorDistance(origin, closeNeighbor);
  const distFar = Util.xorDistance(origin, farNeighbor);

  assertEquals(distClose < distFar, true);
});

Deno.test('Util - xorDistance() - Handles unequal string lengths safely', () => {
  const shortKey = 'abc';
  const longKey = 'abcdef';

  const dist = Util.xorDistance(shortKey, longKey);
  assertNotEquals(dist, 0n);
});

Deno.test('Util - hash() - Deterministic hashing & formatting', () => {
  const mockBlock: SocBlockStruct = {
    e: 1,
    h: 5,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: 'app:test', d: 'test_payload' }],
  };

  const hash1 = Util.hash(mockBlock);
  const hash2 = Util.hash(mockBlock);

  assertEquals(hash1, hash2);
  assertEquals(hash1.length, 43);

  const modifiedBlock: SocBlockStruct = {
    ...mockBlock,
    cs: [{ c: COMMAND_DATA, ns: 'app:test', d: 'tampered_payload' }],
  };
  const hashModified = Util.hash(modifiedBlock);
  assertNotEquals(hash1, hashModified);
});

Deno.test('Util - verifySignature() - Valid and Invalid Signatures', async () => {
  const tempDir = Deno.makeTempDirSync();
  const pathKeystore = path.join(tempDir, 'keystore.enc');
  const passphraseStr = 'util_test_passphrase';

  const config = {
    path_keystore: pathKeystore,
    i2p_sam_http: '127.0.0.1:7656',
    i2p_sam_udp: '127.0.0.1:7656',
  } as unknown as Config;

  createDummyKeystore(pathKeystore, passphraseStr);

  const passphraseBuf = createHash('sha256').update(passphraseStr).digest();
  const wallet = await Wallet.make(config, passphraseBuf);

  try {
    const pk = wallet.getPublicKey();
    const payload = 'my_important_transaction_data';
    const signature = wallet.sign(payload);

    const isValid = Util.verifySignature(pk, signature, payload);
    assertEquals(isValid, true);

    const isTamperedValid = Util.verifySignature(
      pk,
      signature,
      'tampered_data',
    );
    assertEquals(isTamperedValid, false);

    const invalidSignature = 'A'.repeat(86);
    const isBadSigValid = Util.verifySignature(pk, invalidSignature, payload);
    assertEquals(isBadSigValid, false);

    const isMalformedValid = Util.verifySignature(
      'invalid_pk',
      'invalid_sig',
      payload,
    );
    assertEquals(isMalformedValid, false);
  } finally {
    wallet.close();
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test('Util - shuffleArray() - Array shuffling integrity', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffled = Util.shuffleArray(original);

  assertEquals(shuffled.length, original.length);
  assertNotEquals(shuffled, original);
  assertEquals(shuffled.sort((a, b) => a - b), original);
});

Deno.test('Util - QuartileCoeff() - Dispersion and input validation', () => {
  const numbers = [10, 20, 30, 40, 50, 60, 70, 80];
  const coeff = Util.QuartileCoeff(numbers);
  assertEquals(typeof coeff, 'number');

  assertThrows(
    () => Util.QuartileCoeff([1, 2, 3]),
    Error,
    'Invalid Argument',
  );
});

Deno.test('Util - stringDiff() - Character distance and input errors', () => {
  const diff = Util.stringDiff('abc', 'adc');
  assertEquals(diff, 2);

  assertThrows(
    () => Util.stringDiff('abc', 'abcd'),
    Error,
    'Invalid string input',
  );

  assertThrows(
    () => Util.stringDiff('', ''),
    Error,
    'Invalid string input',
  );
});

Deno.test('Util - hashString() - Basic string hashing', () => {
  const hash1 = Util.hashString('hello diva');
  const hash2 = Util.hashString('hello diva');

  assertEquals(hash1, hash2);
  assertEquals(hash1.length, 43);
});

Deno.test('Util - isI2pBase32Address() strictly validates 52-char Base32 .b32.i2p addresses', () => {
  const valid1 = 'v3q444444444444444444444444444444444444444444444444a.b32.i2p';
  const valid2 = 'w5q234567abcdefghijklmnopqrstuvwxyz234567abcdefghijk.b32.i2p';

  assertEquals(Util.isI2pBase32Address(valid1), true);
  assertEquals(Util.isI2pBase32Address(valid2), true);

  assertEquals(Util.isI2pBase32Address('seed1.b32.i2p'), false);
  assertEquals(Util.isI2pBase32Address('invalid-domain.com'), false);

  assertEquals(
    Util.isI2pBase32Address(
      'v3q844444444444444444444444444444444444444444444444a.b32.i2p',
    ),
    false,
  );
  assertEquals(
    Util.isI2pBase32Address(
      'v3q044444444444444444444444444444444444444444444444a.b32.i2p',
    ),
    false,
  );
  assertEquals(
    Util.isI2pBase32Address(
      'v3q144444444444444444444444444444444444444444444444a.b32.i2p',
    ),
    false,
  );

  assertEquals(
    Util.isI2pBase32Address(
      'V3Q444444444444444444444444444444444444444444444444A.b32.i2p',
    ),
    false,
  );
});
