/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists, assertFalse } from '@std/assert';
import {
  Network,
  Peer,
  PEER_STATUS_CITIZEN,
  PEER_STATUS_GUEST,
} from '../../../src/net/network.ts';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
  SocBlockStruct,
} from '../../../src/chain/block.ts';
import { Util } from '../../../src/chain/util.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import {
  BlockAnnouncementStruct,
  Message,
  SlashingProofStruct,
  SocAnnouncementStruct,
  TYPE_BLOCK_ANNOUNCEMENT,
  TYPE_SLASHING_PROOF,
  TYPE_SOC_ANNOUNCEMENT,
  TYPE_STATUS,
  TYPE_VOTE,
} from '../../../src/net/message/message.ts';
import { VoteStruct } from '../../../src/chain/vote.ts';
import { StatusStruct } from '../../../src/net/message/status.ts';
import { createTestContext } from '../../helpers/env.ts';
import { MOCK_HASH, MOCK_I2P_DEST, MOCK_SIG } from '../../helpers/keystore.ts';

type NetworkPrivate = {
  isEnforcingGuestCapacity: boolean;
  enforceGuestCapacity: () => Promise<void>;
  runEvictionSweep: (currentEpoch: number) => Promise<void>;
  onUdpData: (data: Uint8Array, from: string) => void;
  setStatus: (origin: string, statusList: unknown) => void;
  validateMessage: (msg: string) => [unknown | null, Error | null];
  prepareMessage: (data: Uint8Array) => [string | null, Error | null];
  verifyReplicationProof: (
    origin: string,
    rp: string,
    consensusHash: string,
  ) => Promise<{ v: boolean; g: boolean }>;
  getReplicationTarget: (
    origin: string,
    consensusHash: string,
  ) => Promise<string | null>;
  updateP2PNetwork: () => void;
  broadcastStatus: () => Promise<void>;
  loadSeed: () => Promise<void>;
  initHttp: (config: unknown) => Promise<void>;
  initUdp: (config: unknown) => Promise<void>;
  samHttpForward: unknown;
  samUdp: { send: (dest: string, data: Uint8Array) => void };
  setIn: Set<string>;
  localEpochCountK: number;
  localEpochTracked: number;
  timeoutStatus: ReturnType<typeof setTimeout>;
};

async function setupNetworkTest() {
  const ctx = await createTestContext();
  const network = await Network.make(ctx.server);

  (network as unknown as { hasP2PNetwork: () => boolean }).hasP2PNetwork = () =>
    true;

  return { ...ctx, network };
}

Deno.test('Network - Peer Management, Capacity & Removal Guards', async () => {
  const ctx = await setupNetworkTest();

  try {
    const peerPk = 'peer_node_pk_' + '0'.repeat(30);
    const peer: Peer = {
      publicKey: peerPk,
      http: 'peer_http.b32.i2p',
      udp: 'peer_udp.b32.i2p',
      status: PEER_STATUS_GUEST,
      joinedAtEpoch: 0,
    };

    assertEquals(await ctx.network.addPeer(peer), true);
    assertEquals(await ctx.network.addPeer(peer), false);
    assertEquals(ctx.network.hasPeer(peerPk), true);

    const netPrivate = ctx.network as unknown as NetworkPrivate;
    netPrivate.isEnforcingGuestCapacity = true;
    await netPrivate.enforceGuestCapacity();
    netPrivate.isEnforcingGuestCapacity = false;

    const myPk = ctx.wallet.getNodePublicKey();
    await ctx.network.removePeer(myPk);
    assertEquals(ctx.network.hasPeer(myPk), true);

    await ctx.network.removePeer(peerPk);
    assertEquals(ctx.network.hasPeer(peerPk), false);
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Message Preparation & Regex Validation Errors', async () => {
  const ctx = await setupNetworkTest();

  try {
    const netPrivate = ctx.network as unknown as NetworkPrivate;

    const [shortMsg, errShort] = netPrivate.prepareMessage(new Uint8Array(5));
    assertEquals(shortMsg, null);
    assertExists(errShort);

    const [longMsg, errLong] = netPrivate.prepareMessage(
      new Uint8Array(100_000),
    );
    assertEquals(longMsg, null);
    assertExists(errLong);

    const [badFmt, errFmt] = netPrivate.validateMessage(
      'malformed_raw_payload',
    );
    assertEquals(badFmt, null);
    assertEquals(errFmt?.message, 'Invalid message format');

    // Origin PK MUST be exactly 43 characters long to pass regex matching
    const unknownPk = 'unknown_origin_pk_' + '0'.repeat(25);
    const voteStruct: VoteStruct = { e: 2, ha: MOCK_HASH };
    const voteMsg = new Message(voteStruct, TYPE_VOTE, unknownPk);
    const rawVoteStr = await voteMsg.asString(ctx.wallet);

    const [unknRes, errUnkn] = netPrivate.validateMessage(rawVoteStr);
    assertEquals(unknRes, null);
    assertEquals(errUnkn?.message, 'Message from unknown origin');
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Guest Lifecycle & Eviction Sweep', async () => {
  const ctx = await setupNetworkTest();

  try {
    const guestEvictPk = 'guest_evict_' + '0'.repeat(32);
    const guestNaturalizePk = 'guest_naturalize_' + '0'.repeat(27);

    await ctx.network.addPeer({
      publicKey: guestEvictPk,
      http: 'evict.b32.i2p',
      udp: 'evict_udp.b32.i2p',
      status: PEER_STATUS_GUEST,
      joinedAtEpoch: 1,
    });
    await ctx.network.addPeer({
      publicKey: guestNaturalizePk,
      http: 'naturalize.b32.i2p',
      udp: 'naturalize_udp.b32.i2p',
      status: PEER_STATUS_GUEST,
      joinedAtEpoch: 1,
    });

    const [prevBlock] = ctx.chain.getLatestConsensusBlock();
    assertExists(prevBlock);

    const epoch2Block: ConsensusBlockStruct = {
      e: 2,
      p: prevBlock.ha,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: guestNaturalizePk, r: 500 }],
        },
      ],
      ha: '',
    };
    epoch2Block.ha = Util.hash(epoch2Block);
    await ctx.chain.addConsensusBlock(epoch2Block);

    const netPrivate = ctx.network as unknown as NetworkPrivate;
    await netPrivate.runEvictionSweep(12);

    assertEquals(ctx.network.hasPeer(guestEvictPk), false);
    assertEquals(ctx.network.hasPeer(guestNaturalizePk), true);
    assertEquals(
      ctx.network.getPeer(guestNaturalizePk)?.status,
      PEER_STATUS_CITIZEN,
    );
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - UDP Message Routing & Message Types', async () => {
  const ctx = await setupNetworkTest();

  try {
    const myPk = ctx.wallet.getNodePublicKey();
    await ctx.network.addPeer({
      publicKey: myPk,
      http: MOCK_I2P_DEST,
      udp: MOCK_I2P_DEST,
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 0,
    });

    const netPrivate = ctx.network as unknown as NetworkPrivate;
    netPrivate.samHttpForward = { close: () => {} };
    netPrivate.samUdp = { send: () => {} };

    const voteStruct: VoteStruct = { e: 2, ha: MOCK_HASH };
    const voteMsg = new Message(voteStruct, TYPE_VOTE, myPk);
    netPrivate.onUdpData(
      new TextEncoder().encode(await voteMsg.asString(ctx.wallet)),
      MOCK_I2P_DEST,
    );

    const slashingStruct: SlashingProofStruct = {
      e: 2,
      pk: ctx.wallet.getNodePublicKey(),
      v1: { pow: 'B'.repeat(48), pl: 'C'.repeat(100), s: 'D'.repeat(86) },
      v2: { pow: 'E'.repeat(48), pl: 'F'.repeat(100), s: 'G'.repeat(86) },
    };
    const slashingMsg = new Message(slashingStruct, TYPE_SLASHING_PROOF, myPk);
    netPrivate.onUdpData(
      new TextEncoder().encode(await slashingMsg.asString(ctx.wallet)),
      MOCK_I2P_DEST,
    );

    const announcement: BlockAnnouncementStruct = {
      e: 2,
      ha: MOCK_HASH,
      sig: ctx.wallet.signNode(MOCK_HASH),
    };
    const announceMsg = new Message(
      announcement,
      TYPE_BLOCK_ANNOUNCEMENT,
      myPk,
    );
    netPrivate.onUdpData(
      new TextEncoder().encode(await announceMsg.asString(ctx.wallet)),
      MOCK_I2P_DEST,
    );

    const socAnnounceStruct: SocAnnouncementStruct = {
      e: 1,
      h: 2,
      ha: MOCK_HASH,
      sig: ctx.wallet.sign(MOCK_HASH),
    };
    const socMsg = new Message(socAnnounceStruct, TYPE_SOC_ANNOUNCEMENT, myPk);
    netPrivate.onUdpData(
      new TextEncoder().encode(await socMsg.asString(ctx.wallet)),
      MOCK_I2P_DEST,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Peer & Address Lookup Helpers', async () => {
  const ctx = await setupNetworkTest();

  try {
    const peerPk = 'lookup_peer_pk_' + '0'.repeat(28);
    const httpAddr = 'lookup_http.b32.i2p';
    const udpAddr = 'lookup_udp.b32.i2p';

    await ctx.network.addPeer({
      publicKey: peerPk,
      http: httpAddr,
      udp: udpAddr,
      status: PEER_STATUS_GUEST,
      joinedAtEpoch: 1,
    });

    assertEquals(ctx.network.getPublicKeyByHttp(httpAddr), peerPk);
    assertEquals(ctx.network.getPublicKeyByHttp('unknown_http'), '');

    assertEquals(ctx.network.getPublicKeyByUdp(udpAddr), peerPk);
    assertEquals(ctx.network.getPublicKeyByUdp('unknown_udp'), '');

    assertEquals(ctx.network.hasNetworkHttp(httpAddr), true);
    assertFalse(ctx.network.hasNetworkHttp('unknown_http'));

    const peerList = ctx.network.getListPeer();
    assertEquals(peerList.includes(peerPk), true);

    const mapPeer = ctx.network.getMapPeer();
    assertEquals(mapPeer.has(peerPk), true);
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Broadcast Status, K-Clock Trigger & Rep 0 Challenge', async () => {
  const ctx = await setupNetworkTest();

  try {
    const netPrivate = ctx.network as unknown as NetworkPrivate;
    let epochChangedEpoch: number | null = null;

    (ctx.server.getConsensusFactory() as unknown as Record<string, unknown>)
      .triggerEpochChange = (epoch: number) => {
        epochChangedEpoch = epoch;
      };

    const citizenPeerPk = 'citizen_target_' + '0'.repeat(27);
    await ctx.chain.addSoc(citizenPeerPk);

    const [prevSoc] = ctx.chain.getLatestSocBlock(citizenPeerPk);
    const socBlock: SocBlockStruct = {
      e: 1,
      h: prevSoc ? prevSoc.h + 1 : 1,
      ha: '',
      p: prevSoc ? prevSoc.ha : MOCK_HASH,
      sig: MOCK_SIG,
      cs: [{ c: COMMAND_DATA, ns: 'app:test', d: 'data' }],
    };
    socBlock.ha = Util.hash(socBlock);
    await ctx.chain.addSocBlock(citizenPeerPk, socBlock);

    await ctx.network.addPeer({
      publicKey: citizenPeerPk,
      http: 'cit.b32.i2p',
      udp: 'cit_udp.b32.i2p',
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 1,
    });

    for (let i = 0; i < 5; i++) {
      await netPrivate.broadcastStatus();
      if (netPrivate.timeoutStatus) {
        clearTimeout(netPrivate.timeoutStatus);
      }
    }

    assertEquals(epochChangedEpoch, 1);
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - verifyReplicationProof() Zero Reputation & Chunk Hashing', async () => {
  const ctx = await setupNetworkTest();

  try {
    const netPrivate = ctx.network as unknown as NetworkPrivate;
    const origin = 'zero_rep_node_' + '0'.repeat(29);

    const citizenPk = ctx.validators[0].pk;
    const proofCitizen = await netPrivate.verifyReplicationProof(
      citizenPk,
      'any_hash',
      MOCK_HASH,
    );
    assertEquals(proofCitizen, { v: true, g: false });

    const proofZeroNoTarget = await netPrivate.verifyReplicationProof(
      origin,
      Util.hashString(MOCK_HASH + '[]'),
      MOCK_HASH,
    );
    assertEquals(proofZeroNoTarget.g, true);

    const targetPeer = 'replication_target_' + '0'.repeat(24);
    await ctx.chain.addSoc(targetPeer);
    const socBlock: SocBlockStruct = {
      e: 1,
      h: 1,
      ha: '',
      p: MOCK_HASH,
      sig: MOCK_SIG,
      cs: [{ c: COMMAND_DATA, ns: 'app:chunk', d: 'payload_chunk' }],
    };
    socBlock.ha = Util.hash(socBlock);
    await ctx.chain.addSocBlock(targetPeer, socBlock);

    netPrivate.getReplicationTarget = async () => targetPeer;

    const chunk = await ctx.chain.getRange(1, 1, targetPeer);
    const chunkPayload = JSON.stringify(chunk.map((b) => b.cs));
    const expectedRp = Util.hashString(MOCK_HASH + chunkPayload);

    const proofValid = await netPrivate.verifyReplicationProof(
      origin,
      expectedRp,
      MOCK_HASH,
    );
    assertEquals(proofValid, { v: true, g: true });

    const proofInvalid = await netPrivate.verifyReplicationProof(
      origin,
      'bad_rp_hash',
      MOCK_HASH,
    );
    assertEquals(proofInvalid, { v: false, g: true });
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - getNextValidators() Full Tiered Allocation & Fallback', async () => {
  const ctx = await setupNetworkTest();

  try {
    const netPrivate = ctx.network as unknown as NetworkPrivate;
    const reputationTable: Array<{ pk: string; r: number }> = [];

    for (let i = 0; i < 10; i++) {
      const pk = `veteran_node_${String(i).padStart(2, '0')}_` + '0'.repeat(27);
      reputationTable.push({ pk, r: 10_000_000 });
      netPrivate.setStatus(pk, [{
        e: 1,
        vrf: `vrf_vet_${i}`,
        t: Date.now(),
        rp: '',
        sig: '',
      }]);
    }

    for (let i = 0; i < 10; i++) {
      const pk = `newcomer_node_${String(i).padStart(2, '0')}_` +
        '0'.repeat(26);
      reputationTable.push({ pk, r: 1_500_000 });
      netPrivate.setStatus(pk, [{
        e: 1,
        vrf: `vrf_new_${i}`,
        t: Date.now(),
        rp: '',
        sig: '',
      }]);
    }

    for (let i = 0; i < 10; i++) {
      const pk = `guest_node_${String(i).padStart(2, '0')}_` + '0'.repeat(29);
      reputationTable.push({ pk, r: 100_000 });
      netPrivate.setStatus(pk, [{
        e: 1,
        vrf: `vrf_gst_${i}`,
        t: Date.now(),
        rp: '',
        sig: '',
      }]);
    }

    const nextValidators = ctx.network.getNextValidators(
      1,
      ctx.validators,
      reputationTable,
    );

    assertEquals(nextValidators.length, 31);
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Telemetry & Quorum BFT Calculations', async () => {
  const ctx = await setupNetworkTest();

  try {
    ctx.network.addHttpRx(1024);
    ctx.network.addHttpTx(2048);

    const hasQuorum = await ctx.network.hasQuorumBFT(2);
    assertEquals(typeof hasQuorum, 'boolean');
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});

Deno.test('Network - Broadcast Transmission, Size Limits & Retries', async () => {
  const ctx = await setupNetworkTest();

  try {
    const peerPk = 'target_broadcast_pk_' + '0'.repeat(24);
    await ctx.network.addPeer({
      publicKey: peerPk,
      http: 'bc_http.b32.i2p',
      udp: 'bc_udp.b32.i2p',
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 1,
    });

    const netPrivate = ctx.network as unknown as NetworkPrivate;
    let sendCalls = 0;
    netPrivate.samHttpForward = { close: () => {} };
    netPrivate.samUdp = {
      send: () => {
        sendCalls++;
      },
    };

    netPrivate.updateP2PNetwork();

    ctx.network.broadcast('short');
    assertEquals(sendCalls, 0);

    const validSizeMessage = 'X'.repeat(250);
    ctx.network.broadcast(validSizeMessage);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    assertEquals(sendCalls >= 1, true);
  } finally {
    await ctx.network.shutdown();
    await ctx.cleanup();
  }
});
