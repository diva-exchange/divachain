/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { Config } from '../../src/config.ts';
import { Wallet } from '../../src/chain/wallet.ts';
import { Chain } from '../../src/chain/chain.ts';
import { Network } from '../../src/net/network.ts';
import {
  createDummyKeystore,
  generateValidators,
  MOCK_PK,
  ZERO_HASH,
} from './keystore.ts';
import { createMockServer } from './mocks.ts';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
  SocBlockStruct,
} from '../../src/chain/block.ts';
import { Namespace } from '../../src/chain/namespace.ts';
import { Util } from '../../src/chain/util.ts';

const proto = Network.prototype as any;
proto.initHttp = async function () {};
proto.initUdp = async function () {};
proto.hasP2PNetwork = function () {
  return Boolean(this.dbPeer && typeof this.dbPeer.put === 'function');
};

export async function createTestContext(options: {
  isTestnet?: boolean;
  passphrase?: string;
  decoys?: number;
  skipChain?: boolean;
} = {}) {
  const tempDir = Deno.makeTempDirSync();
  const passphraseStr = options.passphrase || 'test_passphrase';
  const pathKeystore = path.join(tempDir, 'keystore.enc');
  const pathGenesisConsensus = path.join(tempDir, 'genesis_consensus.json');
  const pathGenesisSoc = path.join(tempDir, 'genesis_soc.json');
  const pathPeerSeed = path.join(tempDir, 'peer_seed.json');

  const validators = generateValidators();
  const genesisConsensusBlock: ConsensusBlockStruct = {
    e: 1,
    p: ZERO_HASH,
    cs: [
      {
        c: COMMAND_VALIDATORS,
        ns: Namespace.consensusForEpoch(1),
        d: validators,
      },
      {
        c: COMMAND_REPUTATION,
        ns: Namespace.reputationForEpoch(1),
        d: [{ pk: validators[0].pk, r: 100_000 }],
      },
    ],
    ha: '',
  };
  genesisConsensusBlock.ha = Util.hash(genesisConsensusBlock);

  const genesisSocBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    sig: '',
    p: ZERO_HASH,
    ha: '',
    cs: [{ c: COMMAND_DATA, ns: 'app:system', d: MOCK_PK }],
  };
  genesisSocBlock.ha = Util.hash(genesisSocBlock);

  Deno.writeTextFileSync(
    pathGenesisConsensus,
    JSON.stringify(genesisConsensusBlock),
  );
  Deno.writeTextFileSync(pathGenesisSoc, JSON.stringify(genesisSocBlock));
  Deno.writeTextFileSync(pathPeerSeed, JSON.stringify([]));

  createDummyKeystore(pathKeystore, passphraseStr);

  const port = Math.floor(20000 + Math.random() * 10000);
  const config = {
    VERSION: '1.0.0-unittest',
    is_testnet: options.isTestnet ?? true,
    ip: '127.0.0.1',
    port,
    port_block_feed: port + 1,
    bootstrap: '',
    path_consensus: path.join(tempDir, 'db_consensus'),
    path_reputation: path.join(tempDir, 'db_reputation'),
    path_soc_index: path.join(tempDir, 'db_soc_index'),
    path_soc: path.join(tempDir, 'db_soc'),
    path_peer_seed: pathPeerSeed,
    path_genesis_consensus: pathGenesisConsensus,
    path_genesis_soc: pathGenesisSoc,
    path_keystore: pathKeystore,
    i2p_sam_http: '127.0.0.1:7656',
    i2p_sam_forward_http: '127.0.0.1:7001',
    i2p_sam_udp: '127.0.0.1:7656',
    i2p_sam_listen_udp: '127.0.0.1:7002',
    i2p_sam_forward_udp: '127.0.0.1:7003',
    i2p_sam_udp_port_udp: 7004,
    i2p_sam_tunnel_var_min: 0,
    i2p_sam_tunnel_var_max: 0,
    i2p_socks: '127.0.0.1:9050',
    network_timeout_ms: 250,
    chain_max_blocks_in_memory: 10,
    api_max_query_size: 100,
    network_p2p_interval_ms: 1000,
    decoys: options.decoys || 1,
  } as Config;

  const passphraseBuf = createHash('sha256').update(passphraseStr).digest();
  const wallet = await Wallet.make(config, passphraseBuf);
  const server = createMockServer(config, wallet);

  let chain: Chain | null = null;
  if (!options.skipChain) {
    chain = await Chain.make(server);
    (server as unknown as { getChain: () => Chain }).getChain = () => chain!;
  }

  return {
    tempDir,
    config,
    wallet,
    server,
    chain: chain!,
    validators,
    async cleanup() {
      if (chain) {
        await chain.shutdown();
      }
      wallet.close();
      Deno.removeSync(tempDir, { recursive: true });
    },
  };
}
