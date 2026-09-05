/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists } from '@std/assert';
import sodium from 'sodium-native';
import { encodeBase64Url } from '@std/encoding';
import { SocFactory } from '../../../src/net/soc-factory.ts';
import { COMMAND_DATA, CommandData } from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { Economics } from '../../../src/chain/economics.ts';
import { createTestContext } from '../../helpers/env.ts';

type SocFactoryPrivate = {
  generateDecoyBlock: () => Promise<void>;
  intervalDecoy: ReturnType<typeof setInterval> | null;
};

Deno.test('SocFactory - createLocalBlock() on initialized primary chain', async () => {
  const ctx = await createTestContext();

  try {
    const factory = SocFactory.make(ctx.server);
    const myPk = ctx.wallet.getPublicKey();

    const command: CommandData = {
      c: COMMAND_DATA,
      ns: 'app:chat',
      d: 'Hello World Payload',
    };

    const block = await factory.createLocalBlock([command], myPk);
    assertExists(block);
    assertEquals(block.h, 2);
    assertEquals(block.cs[0].d, 'Hello World Payload');

    const [height] = ctx.chain.getHeight(myPk);
    assertEquals(height, 2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('SocFactory - createLocalBlock() rejects uninitialized chain without sys:identity', async () => {
  const ctx = await createTestContext();

  try {
    const factory = SocFactory.make(ctx.server);
    const uninitializedPk = 'uninit_pk_' + '0'.repeat(30);

    const command: CommandData = {
      c: COMMAND_DATA,
      ns: 'app:chat',
      d: 'Test Payload',
    };

    const block = await factory.createLocalBlock([command], uninitializedPk);
    assertEquals(block, null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('SocFactory - createLocalBlock() initializes chain with sys:identity PoW command', async () => {
  const ctx = await createTestContext();

  try {
    const factory = SocFactory.make(ctx.server);

    const uninitializedPkBuf = sodium.sodium_malloc(
      sodium.crypto_sign_PUBLICKEYBYTES,
    );
    const uninitializedSkBuf = sodium.sodium_malloc(
      sodium.crypto_sign_SECRETKEYBYTES,
    );
    sodium.crypto_sign_keypair(uninitializedPkBuf, uninitializedSkBuf);
    const uninitializedPk = encodeBase64Url(new Uint8Array(uninitializedPkBuf));

    const powNonce = await Util.grindIdentityPoW(uninitializedPk);
    const genesisCommand: CommandData = {
      c: COMMAND_DATA,
      ns: Namespace.SYS_IDENTITY,
      d: powNonce,
    };

    const block = await factory.createLocalBlock(
      [genesisCommand],
      uninitializedPk,
    );
    assertExists(block);
    assertEquals(block.h, 2);

    const [height] = ctx.chain.getHeight(uninitializedPk);
    assertEquals(height, 2);

    sodium.sodium_memzero(uninitializedSkBuf);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('SocFactory - Decoy Loop Lifecycle & Generation', async () => {
  const ctx = await createTestContext();

  try {
    const factory = SocFactory.make(ctx.server);
    const factoryPrivate = factory as unknown as SocFactoryPrivate;

    factory.startDecoyLoop();
    assertExists(factoryPrivate.intervalDecoy);

    factory.shutdown();

    ctx.chain.getLatestReputation = async () => 0;
    await factoryPrivate.generateDecoyBlock();

    ctx.chain.getLatestReputation = async () =>
      Economics.REPUTATION_BUILD_STEP_UPTIME + 100;
    await factoryPrivate.generateDecoyBlock();
  } finally {
    await ctx.cleanup();
  }
});
