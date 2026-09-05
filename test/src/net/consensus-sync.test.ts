/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists, assertFalse } from '@std/assert';
import { ConsensusSync } from '../../../src/net/consensus-sync.ts';
import {
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
} from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { createSyncTestContext } from '../../helpers/sync.ts';

Deno.test('ConsensusSync - State Tracking & Mutex Guard (isSyncing)', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    assertEquals(syncManager.isSyncing(), false);

    const promise1 = syncManager.sync();
    assertEquals(syncManager.isSyncing(), true);

    const promise2 = syncManager.sync();
    await Promise.all([promise1, promise2]);

    assertEquals(syncManager.isSyncing(), false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Already up to date (no remote height advantage)', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    ctx.mockState.latestRemoteBlock = ctx.genesisConsensusBlock;

    const res = await syncManager.sync(1);
    assertEquals(res, true);

    const [currentLocalBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(currentLocalBlock);
    assertEquals(currentLocalBlock.e, 1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Single-Epoch Concurrent Sync via hintPeerPk', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const epoch2Block: ConsensusBlockStruct = {
      e: 2,
      p: ctx.genesisConsensusBlock.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: ctx.validators[0].pk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    epoch2Block.ha = Util.hash(epoch2Block);

    ctx.mockState.latestRemoteBlock = epoch2Block;
    ctx.mockState.peersByEpoch = [];

    const success = await syncManager.sync(2, ctx.mockPeerPk);
    assertEquals(success, true);

    const [latestLocalBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(latestLocalBlock);
    assertEquals(latestLocalBlock.e, 2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Fast Catch-Up Sync (Lag > 1)', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const epoch2Block: ConsensusBlockStruct = {
      e: 2,
      p: ctx.genesisConsensusBlock.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: ctx.validators[0].pk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    epoch2Block.ha = Util.hash(epoch2Block);

    const epoch3Block: ConsensusBlockStruct = {
      e: 3,
      p: epoch2Block.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(3),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(3),
          d: [{ pk: ctx.validators[0].pk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    epoch3Block.ha = Util.hash(epoch3Block);

    ctx.mockState.latestRemoteBlock = epoch3Block;
    ctx.mockState.remoteRange = [epoch2Block, epoch3Block];

    const success = await syncManager.sync(3);
    assertEquals(success, true);

    const [latestLocalBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(latestLocalBlock);
    assertEquals(latestLocalBlock.e, 3);
    assertEquals(latestLocalBlock.ha, epoch3Block.ha);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Generic sync() with findNetworkTarget()', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const epoch2Block: ConsensusBlockStruct = {
      e: 2,
      p: ctx.genesisConsensusBlock.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: ctx.validators[0].pk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    epoch2Block.ha = Util.hash(epoch2Block);

    ctx.mockState.latestRemoteBlock = epoch2Block;
    ctx.mockState.remoteRange = [epoch2Block];

    const success = await syncManager.sync();
    assertEquals(success, true);

    const [latestLocalBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(latestLocalBlock);
    assertEquals(latestLocalBlock.e, 2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Penalizes peer on structural validation error', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const invalidBlock: ConsensusBlockStruct = {
      e: 2,
      p: ctx.genesisConsensusBlock.ha,
      cs: [],
      ha: 'invalid_hash',
    };

    ctx.mockState.latestRemoteBlock = invalidBlock;
    ctx.mockState.failValidation = true;

    const res = await syncManager.sync(2, ctx.mockPeerPk);
    assertEquals(res, false);

    const secondTry = await syncManager.sync(2, ctx.mockPeerPk);
    assertEquals(secondTry, false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Penalizes peer on cryptographic chain addition error', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const epoch2Block: ConsensusBlockStruct = {
      e: 2,
      p: ctx.genesisConsensusBlock.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: ctx.validators[0].pk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    epoch2Block.ha = Util.hash(epoch2Block);

    ctx.mockState.latestRemoteBlock = epoch2Block;
    ctx.mockState.failChainAddition = true;

    const res = await syncManager.sync(2, ctx.mockPeerPk);
    assertEquals(res, false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Penalizes peer on range chain continuum break (block.p !== expectedPrevHash)', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const brokenBlock: ConsensusBlockStruct = {
      e: 2,
      p: 'wrong_previous_hash_00000000000000000000',
      cs: [],
      ha: 'some_hash_000000000000000000000000000000',
    };

    ctx.mockState.remoteRange = [brokenBlock];

    const res = await syncManager.sync(3);
    assertEquals(res, false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusSync - Handles network/API fetch failures gracefully', async () => {
  const ctx = await createSyncTestContext();
  const syncManager = ConsensusSync.make(ctx.server);

  try {
    const res = await syncManager.sync(2);
    assertFalse(res);

    assertEquals(syncManager.isSyncing(), false);
    const [latestLocalBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(latestLocalBlock);
    assertEquals(latestLocalBlock.e, 1);
  } finally {
    await ctx.cleanup();
  }
});
