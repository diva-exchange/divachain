/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { SocSync } from '../../../src/net/soc-sync.ts';
import { COMMAND_DATA, SocBlockStruct } from '../../../src/chain/block.ts';
import { Util } from '../../../src/chain/util.ts';
import { PEER_STATUS_CITIZEN } from '../../../src/net/network.ts';
import { createTestContext } from '../../helpers/env.ts';
import { MOCK_I2P_DEST, ZERO_HASH } from '../../helpers/keystore.ts';

type SocSyncPrivate = {
  pullMissingBlocks: (
    nodeId: string,
    startHeight: number,
    targetHeight: number,
    socKey?: string,
  ) => Promise<void>;
  discoverPeer: (pk: string) => Promise<void>;
  setIsSyncing: Set<string>;
};

Deno.test('SocSync - processSocAnnouncement & isSyncActive state', async () => {
  const ctx = await createTestContext();

  try {
    const socSync = SocSync.make(ctx.server);
    assertEquals(socSync.isSyncActive(), false);

    const socKey = ctx.wallet.getPublicKey();
    const senderNodeId = ctx.wallet.getNodePublicKey();

    await socSync.processSocAnnouncement(
      { e: 0, h: 1, ha: ZERO_HASH, sig: 'mock_sig' },
      socKey,
      senderNodeId,
    );
    assertEquals(socSync.isSyncActive(), false);

    await socSync.processSocAnnouncement(
      { e: 1, h: 1, ha: ZERO_HASH, sig: 'mock_sig' },
      socKey,
      senderNodeId,
    );
    assertEquals(socSync.isSyncActive(), false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('SocSync - pullMissingBlocks (Failures & Success)', async () => {
  const ctx = await createTestContext();

  try {
    const socSync = SocSync.make(ctx.server);
    const syncPrivate = socSync as unknown as SocSyncPrivate;
    const remotePk = 'remote_pull_pk';

    let fetchResponse: Response = new Response(null, { status: 500 });
    ctx.server.fetchFromApi = async () => fetchResponse;

    fetchResponse = new Response(null, { status: 500 });
    await syncPrivate.pullMissingBlocks(remotePk, 2, 2);

    fetchResponse = new Response('[]', { status: 200 });
    await syncPrivate.pullMissingBlocks(remotePk, 2, 2);

    await ctx.chain.addSoc(remotePk);
    fetchResponse = new Response(JSON.stringify([{ h: 5 }]), { status: 200 });
    await syncPrivate.pullMissingBlocks(remotePk, 2, 2);

    const invalidBlock = { h: 2, e: 1, p: '', cs: [], ha: 'bad_hash' };
    fetchResponse = new Response(JSON.stringify([invalidBlock]), {
      status: 200,
    });
    await syncPrivate.pullMissingBlocks(remotePk, 2, 2);

    const [prevGenesis] = ctx.chain.getLatestSocBlock(remotePk);
    const validBlock: SocBlockStruct = {
      e: 1,
      h: 2,
      ha: '',
      p: prevGenesis ? prevGenesis.ha : ZERO_HASH,
      sig: '',
      cs: [{ c: COMMAND_DATA, ns: 'app:chat', d: 'Test' }],
    };
    validBlock.ha = Util.hash(validBlock);

    const origValidate = ctx.server.getValidation().validateSocBlock;
    ctx.server.getValidation().validateSocBlock = async (): Promise<void> => {};

    fetchResponse = new Response(JSON.stringify([validBlock]), { status: 200 });
    await syncPrivate.pullMissingBlocks(remotePk, 2, 2);

    const [h] = ctx.chain.getHeight(remotePk);
    assertEquals(h, 2);

    ctx.server.getValidation().validateSocBlock = origValidate;
  } finally {
    await ctx.cleanup();
  }
});

Deno.test('SocSync - discoverPeer (Discovery Paths)', async () => {
  const ctx = await createTestContext();

  try {
    const socSync = SocSync.make(ctx.server);
    const syncPrivate = socSync as unknown as SocSyncPrivate;
    const unknownPk = 'unknown_discovery_pk';

    let peerList: unknown[] = [];
    let fetchResponse: Response = new Response(null, { status: 500 });

    (ctx.server.getNetwork() as unknown as { getArrayNetwork: () => unknown[] })
      .getArrayNetwork = () => peerList;
    ctx.server.fetchFromApi = async () => fetchResponse;

    peerList = [];
    await syncPrivate.discoverPeer(unknownPk);

    peerList = [{
      publicKey: 'helper',
      http: '',
      udp: '',
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 1,
    }];
    await syncPrivate.discoverPeer(unknownPk);

    peerList = [{
      publicKey: 'helper',
      http: MOCK_I2P_DEST,
      udp: MOCK_I2P_DEST,
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 1,
    }];
    fetchResponse = new Response(null, { status: 500 });
    await syncPrivate.discoverPeer(unknownPk);

    fetchResponse = new Response(JSON.stringify([]), { status: 200 });
    await syncPrivate.discoverPeer(unknownPk);

    fetchResponse = new Response(
      JSON.stringify([{ publicKey: unknownPk, http: MOCK_I2P_DEST }]),
      { status: 200 },
    );
    await syncPrivate.discoverPeer(unknownPk);
  } finally {
    await ctx.cleanup();
  }
});
