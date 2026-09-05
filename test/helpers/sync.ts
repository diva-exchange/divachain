/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { createTestContext } from './env.ts';
import { ConsensusBlockStruct } from '../../src/chain/block.ts';
import { MOCK_I2P_DEST } from './keystore.ts';
import { PEER_STATUS_CITIZEN } from '../../src/net/network.ts';
import { ConsensusFactory } from '../../src/net/consensus-factory.ts';

export type SyncMockState = {
  latestRemoteBlock: ConsensusBlockStruct | null;
  remoteRange: ConsensusBlockStruct[];
  fetchFromApiFail: boolean;
  peersByEpoch: string[];
  failValidation: boolean;
  failChainAddition: boolean;
};

export async function createSyncTestContext() {
  const ctx = await createTestContext();
  const mockPeerPk = 'remote_peer_pk_' + '0'.repeat(28);

  const mockState: SyncMockState = {
    latestRemoteBlock: null,
    remoteRange: [],
    fetchFromApiFail: false,
    peersByEpoch: [mockPeerPk],
    failValidation: false,
    failChainAddition: false,
  };

  const mockPeer = {
    publicKey: mockPeerPk,
    http: MOCK_I2P_DEST,
    udp: '',
    status: PEER_STATUS_CITIZEN,
    joinedAtEpoch: 1,
  };

  // Network Mocks
  const net = ctx.server.getNetwork() as unknown as Record<string, unknown>;
  net.getArrayNetwork = () => [mockPeer];
  net.getPeer = (pk: string) => (pk === mockPeerPk ? mockPeer : undefined);
  net.getPeersByEpoch = () => mockState.peersByEpoch;

  // Validation Mock
  const val = ctx.server.getValidation() as unknown as Record<string, unknown>;
  val.validateConsensusBlock = (block: ConsensusBlockStruct) => {
    if (mockState.failValidation) {
      throw new Error('Simulated structural validation failure');
    }
    if (!block || typeof block.e !== 'number') {
      throw new Error('Invalid block structure');
    }
  };

  // Chain Addition Error Injection
  const originalAddConsensusBlock = ctx.chain.addConsensusBlock.bind(ctx.chain);
  ctx.chain.addConsensusBlock = async (block: ConsensusBlockStruct) => {
    if (mockState.failChainAddition) {
      throw new Error('Simulated cryptographic chain verification failure');
    }
    return await originalAddConsensusBlock(block);
  };

  // Real ConsensusFactory so that processConsensusBlock properly writes blocks into Chain
  const consensusFactory = ConsensusFactory.make(ctx.server);
  (ctx.server as unknown as Record<string, unknown>).getConsensusFactory = () =>
    consensusFactory;

  // REST API Route Handling Mock
  ctx.server.fetchFromApi = async (url: string) => {
    const r500: Response = new Response(null, { status: 500 });
    if (mockState.fetchFromApiFail) return r500;

    if (
      url.includes('/consensus/latest') || url.includes('/consensus/block/')
    ) {
      if (!mockState.latestRemoteBlock) return r500;
      return new Response(JSON.stringify(mockState.latestRemoteBlock), {
        status: 200,
      });
    }

    if (url.includes('/consensus/range/')) {
      return new Response(JSON.stringify(mockState.remoteRange), {
        status: 200,
      });
    }

    return r500;
  };

  const [genesisConsensusBlock] = ctx.chain.getLatestConsensusBlock();

  return {
    ...ctx,
    mockPeerPk,
    mockState,
    genesisConsensusBlock: genesisConsensusBlock!,
  };
}
