/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from '../../src/net/server.ts';
import { Wallet } from '../../src/chain/wallet.ts';
import { Config } from '../../src/config.ts';
import { MOCK_I2P_DEST, MOCK_SIG } from './keystore.ts';
import { ConsensusBlockStruct } from '../../src/chain/block.ts';

export function createMockNetwork(overrides: Record<string, unknown> = {}) {
  return {
    getArrayNetwork: () => [],
    getArrayBroadcast: () => [],
    getListPeer: () => [],
    getStatus: () => ({}),
    hasPeer: () => true,
    addPeer: async () => true,
    getPeer: (pk: string) => ({
      publicKey: pk,
      http: MOCK_I2P_DEST,
      udp: MOCK_I2P_DEST,
      status: 1,
      joinedAtEpoch: 1,
    }),
    getPeersByEpoch: () => [],
    getNextValidators: (_epoch?: number, currentValidators?: unknown[]) =>
      currentValidators || [],
    hasQuorumBFT: async (count: number) => count >= 2,
    addHttpRx: () => {},
    addHttpTx: () => {},
    broadcast: () => {},
    ...overrides,
  };
}

export function createMockServer(
  config: Config,
  wallet: Wallet,
  overrides: Record<string, unknown> = {},
): Server {
  const mockNetwork = createMockNetwork();
  const mockValidation = {
    validateConsensusBlock: (_block: unknown) => {},
    validateSocBlock: async (_block: unknown, _socKey?: string) => {},
  };
  const mockSocFactory = {
    createLocalBlock: async () => ({}),
  };
  const mockConsensusFactory = {
    getBestConsensusBlock: () => null,
    processConsensusBlock: async (
      block: ConsensusBlockStruct,
      _origin?: string,
      isSync?: boolean,
    ) => {
      const chain = (serverObj as unknown as { getChain?: () => any })
        .getChain?.();
      if (isSync && chain) {
        await chain.addConsensusBlock(block);
      }
      return true;
    },
    processVote: async () => true,
    processSlashingProof: async () => true,
    processBlockAnnouncement: () => true,
    triggerEpochChange: () => {},
  };
  const mockConsensusSync = {
    isSyncing: () => false,
    sync: async () => true,
  };
  const mockSocSync = {
    isSyncActive: () => false,
    processSocAnnouncement: () => {},
  };

  // Fallback signature for unknown test SOC keys
  const originalSign = wallet.sign.bind(wallet);
  wallet.sign = (data: string, originPk?: string) => {
    try {
      return originalSign(data, originPk);
    } catch {
      return MOCK_SIG;
    }
  };

  const serverObj = {
    config,
    getWallet: () => wallet,
    getNetwork: () => mockNetwork,
    getValidation: () => mockValidation,
    getSocFactory: () => mockSocFactory,
    getConsensusFactory: () => mockConsensusFactory,
    getConsensusSync: () => mockConsensusSync,
    getSocSync: () => mockSocSync,
    fetchFromApi: async () => new Response(null, { status: 500 }),
    queueSocWebSocketFeed: () => {},
    queueConsensusWebSocketFeed: () => {},
    ...overrides,
  } as unknown as Server;

  return serverObj;
}
