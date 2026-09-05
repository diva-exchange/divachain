/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists, assertNotEquals } from '@std/assert';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
  ConsensusCommand,
  SocBlockStruct,
} from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { createTestContext } from '../../helpers/env.ts';

const NS_APP_CHAT = 'app:chat';
const NS_APP_PROFILE = 'app:profile';

Deno.test('Chain - Initialization & Genesis Store (Pillar 1)', async () => {
  const ctx = await createTestContext();

  try {
    assertEquals(ctx.chain.getCurrentEpoch(), 1);

    const [latestBlock, err] = ctx.chain.getLatestConsensusBlock();
    assertEquals(err, null);
    assertExists(latestBlock);
    assertEquals(latestBlock.e, 1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('Chain - Add Consensus Blocks & State Rollup (Pillar 2)', async () => {
  const ctx = await createTestContext();

  try {
    const [prevBlock] = ctx.chain.getLatestConsensusBlock();
    const val1 = ctx.validators[0].pk;
    const val2 = ctx.validators[1].pk;

    const block2: ConsensusBlockStruct = {
      e: 2,
      p: prevBlock!.ha,
      cs: [
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [
            { pk: val1, r: 150_000 },
            { pk: val2, r: 50_000 },
          ],
        },
      ],
      ha: '',
    };
    block2.ha = Util.hash(block2);

    await ctx.chain.addConsensusBlock(block2);

    assertEquals(ctx.chain.getCurrentEpoch(), 2);
    assertEquals(await ctx.chain.getLatestReputation(val1), 150_000);
    assertEquals(await ctx.chain.getLatestReputation(val2), 50_000);

    const range = await ctx.chain.getConsensusRange(1, 2);
    assertEquals(range.length, 2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('Chain - Single-Owner-Chain (SOC) Lifecycle', async () => {
  const ctx = await createTestContext();
  const peerPk = ctx.validators[1].pk;

  try {
    await ctx.chain.addSoc(peerPk);
    assertEquals(ctx.chain.getHeight(peerPk)[0], 1);

    const [latestSoc] = ctx.chain.getLatestSocBlock(peerPk);
    assertExists(latestSoc);

    const socBlock2: SocBlockStruct = {
      e: 1,
      h: 2,
      ha: '',
      p: latestSoc.ha,
      sig: '',
      cs: [{ c: COMMAND_DATA, ns: NS_APP_CHAT, d: 'Hello DIVA World!' }],
    };
    socBlock2.ha = Util.hash(socBlock2);

    await ctx.chain.addSocBlock(peerPk, socBlock2);
    assertEquals(ctx.chain.getHeight(peerPk)[0], 2);

    ctx.chain.removeSoc(peerPk);
    assertEquals(ctx.chain.getHeight(peerPk)[0], 0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('Chain - Local App Cache & Index Search (Pillar 3)', async () => {
  const ctx = await createTestContext();
  const myPk = ctx.wallet.getPublicKey();

  try {
    await ctx.chain.addSoc(myPk);
    const [prevBlock] = ctx.chain.getLatestSocBlock(myPk);

    const socBlock: SocBlockStruct = {
      e: 1,
      h: prevBlock!.h + 1,
      ha: '',
      p: prevBlock!.ha,
      sig: '',
      cs: [{ c: COMMAND_DATA, ns: NS_APP_PROFILE, d: '{"name": "Alice"}' }],
    };
    socBlock.ha = Util.hash(socBlock);

    await ctx.chain.addSocBlock(myPk, socBlock);

    const indexResult = await ctx.chain.getSocIndex(
      `${NS_APP_PROFILE}:${myPk}`,
    );
    assertNotEquals(indexResult, false);
    if (indexResult) assertEquals(indexResult.value, '{"name": "Alice"}');

    const searchResults = await ctx.chain.searchSocIndex('Alice');
    assertEquals(searchResults.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('Chain - Reputation State Deltas & Fallbacks', async () => {
  const ctx = await createTestContext();
  const val1 = ctx.validators[0].pk;

  try {
    const [b1] = ctx.chain.getLatestConsensusBlock();

    const b2: ConsensusBlockStruct = {
      e: 2,
      p: b1!.ha,
      cs: [
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: val1, r: 0 }],
        },
      ],
      ha: '',
    };
    b2.ha = Util.hash(b2);
    await ctx.chain.addConsensusBlock(b2);

    assertEquals(await ctx.chain.getLatestReputation(val1), 0);

    const b3: ConsensusBlockStruct = {
      e: 3,
      p: b2.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(3),
          d: ctx.validators,
        },
        {
          c: 'COMMAND_UNKNOWN' as unknown as ConsensusCommand['c'],
          ns: 'unknown',
          d: [],
        } as unknown as ConsensusCommand,
      ],
      ha: '',
    };
    b3.ha = Util.hash(b3);
    await ctx.chain.addConsensusBlock(b3);

    assertNotEquals(
      await ctx.chain.getReputationState(Namespace.reputationForEpoch(3)),
      false,
    );
    assertEquals((await ctx.chain.searchSocIndex('')).length, 2);
  } finally {
    await ctx.cleanup();
  }
});
