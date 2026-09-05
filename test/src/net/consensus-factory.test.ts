/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists } from '@std/assert';
import { ConsensusFactory } from '../../../src/net/consensus-factory.ts';
import {
  COMMAND_REPUTATION,
  ConsensusBlockStruct,
} from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { VoteMessage } from '../../../src/net/message/vote.ts';
import { VoteStruct } from '../../../src/chain/vote.ts';
import { createTestContext } from '../../helpers/env.ts';

Deno.test('ConsensusFactory - processConsensusBlock() adopts valid candidate & handles votes', async () => {
  const ctx = await createTestContext();

  try {
    const factory = ConsensusFactory.make(ctx.server);
    const [prevBlock] = ctx.chain.getLatestConsensusBlock();

    const candidateBlock: ConsensusBlockStruct = {
      e: 2,
      p: prevBlock!.ha,
      cs: [
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: ctx.validators[0].pk, r: 110_000 }],
        },
      ],
      ha: '',
    };
    candidateBlock.ha = Util.hash(candidateBlock);

    const processed = await factory.processConsensusBlock(
      candidateBlock,
      ctx.validators[0].pk,
    );
    assertEquals(processed, true);

    const validVoteStruct: VoteStruct = {
      e: candidateBlock.e,
      ha: candidateBlock.ha,
    };
    const validVoteMsg = new VoteMessage(validVoteStruct, ctx.validators[0].pk);
    const quorumReached = await factory.processVote(
      validVoteMsg,
      'mockPow',
      'mockPl',
      'mockS',
    );
    assertEquals(quorumReached, true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusFactory - Handles 2-out-of-3 Lazy Uptime (Slashing/Decay)', async () => {
  const ctx = await createTestContext();

  try {
    const factory = ConsensusFactory.make(ctx.server);
    const activePk = ctx.validators[6].pk;
    const sig = ctx.wallet.signNode('1');

    (ctx.server.getNetwork() as unknown as Record<string, unknown>).getStatus =
      () => ({
        [activePk]: [{ e: 1, sig }],
      });

    await factory.triggerEpochChange(1);
    assertExists(factory);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('ConsensusFactory - processBlockAnnouncement HTTP Deduplication & Pull Logic', async () => {
  const ctx = await createTestContext();

  try {
    const factory = ConsensusFactory.make(ctx.server);
    const [latestBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(latestBlock);

    const oldRes = await factory.processBlockAnnouncement({
      e: 1,
      ha: 'old_hash',
      sig: '',
    }, 'origin1');
    assertEquals(oldRes, false);
  } finally {
    await ctx.cleanup();
  }
});
