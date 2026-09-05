/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { exists } from '@std/fs';
import fs from 'node:fs';
import { join as joinPath } from 'node:path';
import {
  COMMAND_DATA,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
  SocBlockStruct,
  ValidatorEntry,
} from './chain/block.ts';
import { Namespace } from './chain/namespace.ts';
import {
  Config,
  DEFAULT_I2P_SAM_FORWARD_HTTP_PORT,
  DEFAULT_I2P_SAM_FORWARD_UDP_PORT,
  DEFAULT_I2P_SAM_HTTP_PORT,
  DEFAULT_I2P_SAM_LISTEN_UDP_PORT,
  DEFAULT_I2P_SAM_UDP_PORT,
  DEFAULT_I2P_SOCKS_PORT,
  DEFAULT_IP,
  DEFAULT_PORT,
  DEFAULT_PORT_BLOCK_FEED,
} from './config.ts';
import { Wallet } from './chain/wallet.ts';
import { Util } from './chain/util.ts';
import { Log } from './logger.ts';
import {
  BFT_VALIDATORS_SIZE,
  Peer,
  PEER_STATUS_CITIZEN,
} from './net/network.ts';

enum typeNet {
  dev = 1,
  test,
}

export class Genesis {
  private static readonly MIN_NETWORK_SIZE: number = 64;
  private static readonly MAX_NETWORK_SIZE: number = 128;
  private static readonly DEFAULT_NAME_NODE: string = 'n';
  private static readonly NAME_FILE_GENESIS_CONSENSUS: string =
    'genesis_consensus.json';
  private static readonly NAME_FILE_GENESIS_SOC: string = 'genesis_soc.json';
  private static readonly NAME_FILE_PEER_SEED: string = 'peer-seed.json';

  public static async create(type: typeNet = typeNet.dev) {
    Log.info(`Genesis creation initiated, network type: ${type}`);
    const isTestnet: boolean = (Deno.env.get('IS_TESTNET') || 0) == '1';

    let SIZE_NETWORK: number = Number(Deno.env.get('SIZE_NETWORK') || 0);
    const bootstrap: string = Deno.env.get('BOOTSTRAP') || '';

    if (bootstrap) {
      if (!bootstrap.endsWith('.i2p')) {
        Log.fatal(`Fatal, invalid BOOTSTRAP`);
        Deno.exit(1);
      }
      SIZE_NETWORK = 1;
    } else {
      // Enforce minimum 64 nodes even for local / dev setups
      SIZE_NETWORK = SIZE_NETWORK >= Genesis.MIN_NETWORK_SIZE
        ? SIZE_NETWORK
        : Genesis.MIN_NETWORK_SIZE;

      if (SIZE_NETWORK > Genesis.MAX_NETWORK_SIZE) {
        Log.fatal(`Fatal, SIZE_NETWORK must be <=${Genesis.MAX_NETWORK_SIZE}`);
        Deno.exit(1);
      }
    }

    let explicitPassphraseBuf: Uint8Array | null = null;

    if (!Deno.env.get('DEVNET_MASTER_SEED')) {
      const inputBuf = new Uint8Array(1024);
      const bytesRead = await Deno.stdin.read(inputBuf);
      if (bytesRead !== null) {
        let len = bytesRead;
        while (
          len > 0 && (inputBuf[len - 1] === 10 || inputBuf[len - 1] === 13)
        ) {
          len--;
        }
        explicitPassphraseBuf = new Uint8Array(len);
        explicitPassphraseBuf.set(inputBuf.subarray(0, len));
      }
    }

    let pathDataReal: string = '';
    let pathDataRelative: string = isTestnet ? 'test' : '';
    switch (type) {
      case typeNet.test: {
        pathDataRelative = joinPath(pathDataRelative, 'data', 'test');
        break;
      }
      default: {
        pathDataRelative = joinPath(pathDataRelative, 'data', 'dev');
      }
    }

    const pathApp: string = joinPath(Deno.cwd(), '/');
    pathDataReal = joinPath(pathApp, pathDataRelative);
    !(await exists(pathDataReal)) && fs.mkdirSync(pathDataReal);

    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      const pTest = joinPath(pathApp, pathDataRelative, nameNode);
      if (await exists(pTest)) {
        Log.fatal(`Fatal, path exists: ${pTest}`);
        Deno.exit(1);
      }
    }

    const IP: string = Deno.env.get('IP') || DEFAULT_IP;
    const PORT: number = Number(Deno.env.get('PORT') || DEFAULT_PORT);
    const PORT_BLOCK_FEED: number = Number(
      Deno.env.get('PORT_BLOCK_FEED') || DEFAULT_PORT_BLOCK_FEED,
    );
    const PORT_API_DEBUG: number = Number(
      Deno.env.get('PORT_API_DEBUG') || PORT + 3000,
    );

    const I2P_SOCKS: string = Deno.env.get('I2P_SOCKS') ||
      IP + ':' + DEFAULT_I2P_SOCKS_PORT;
    const I2P_SAM_HTTP: string = Deno.env.get('I2P_SAM_HTTP') ||
      IP + ':' + DEFAULT_I2P_SAM_HTTP_PORT;

    let _a: Array<string> = (Deno.env.get('I2P_SAM_FORWARD_HTTP') ||
      IP + ':' + DEFAULT_I2P_SAM_FORWARD_HTTP_PORT).split(':');
    const I2P_SAM_FORWARD_HTTP: string = _a[0];
    const I2P_SAM_FORWARD_HTTP_PORT: number = Number(_a[1]);

    const I2P_SAM_UDP: string = Deno.env.get('I2P_SAM_UDP') ||
      IP + ':' + DEFAULT_I2P_SAM_UDP_PORT;

    _a = (Deno.env.get('I2P_SAM_LISTEN_UDP') ||
      IP + ':' + DEFAULT_I2P_SAM_LISTEN_UDP_PORT).split(':');
    const I2P_SAM_LISTEN_UDP: string = _a[0];
    const I2P_SAM_LISTEN_UDP_PORT: number = Number(_a[1]);

    _a = (Deno.env.get('I2P_SAM_FORWARD_UDP') ||
      IP + ':' + DEFAULT_I2P_SAM_FORWARD_UDP_PORT).split(':');
    const I2P_SAM_FORWARD_UDP: string = _a[0];
    const I2P_SAM_FORWARD_UDP_PORT: number = Number(_a[1]);

    const aPeerSeed: Array<Peer> = [];
    const aPublicKeys: Array<string> = [];
    const aConfigs: Array<Config> = [];

    let pathDB: string = '';
    let pathLog: string = '';

    // ==========================================
    // PHASE 1: Generate infrastructure and keys
    // ==========================================
    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);

      pathDB = joinPath(pathDataRelative, nameNode, 'db');
      fs.mkdirSync(joinPath(pathApp, pathDB, 'consensus'), { recursive: true });
      fs.mkdirSync(joinPath(pathApp, pathDB, 'soc'));
      fs.mkdirSync(joinPath(pathApp, pathDB, 'reputation'));
      fs.mkdirSync(joinPath(pathApp, pathDB, 'soc_index'));

      pathLog = joinPath(pathDataRelative, nameNode, 'log');
      fs.mkdirSync(joinPath(pathApp, pathLog));

      const pathGenesisConsensus = joinPath(
        pathDB,
        Genesis.NAME_FILE_GENESIS_CONSENSUS,
      );
      const pathGenesisSoc = joinPath(pathDB, Genesis.NAME_FILE_GENESIS_SOC);
      const pathPeerSeed = joinPath(pathDB, Genesis.NAME_FILE_PEER_SEED);
      const pathKeystore = joinPath(pathDB, 'keystore.enc');

      const iPort: number = i * 10;
      const config = Config.make({
        is_testnet: isTestnet,
        bootstrap: bootstrap,
        ip: IP,
        port: PORT + iPort,
        port_block_feed: PORT_BLOCK_FEED + iPort,
        port_api_debug: PORT_API_DEBUG + iPort,
        path_genesis_consensus: bootstrap ? '' : pathGenesisConsensus,
        path_genesis_soc: pathGenesisSoc,
        path_peer_seed: pathPeerSeed,
        path_consensus: joinPath(pathDB, 'consensus'),
        path_soc: joinPath(pathDB, 'soc'),
        path_reputation: joinPath(pathDB, 'reputation'),
        path_soc_index: joinPath(pathDB, 'soc_index'),
        path_keystore: pathKeystore,
        path_log: pathLog,
        i2p_socks: I2P_SOCKS,
        i2p_sam_http: I2P_SAM_HTTP,
        i2p_sam_forward_http: I2P_SAM_FORWARD_HTTP + ':' +
          (I2P_SAM_FORWARD_HTTP_PORT + iPort),
        i2p_sam_udp: I2P_SAM_UDP,
        i2p_sam_listen_udp: I2P_SAM_LISTEN_UDP + ':' +
          (I2P_SAM_LISTEN_UDP_PORT + iPort),
        i2p_sam_forward_udp: I2P_SAM_FORWARD_UDP + ':' +
          (I2P_SAM_FORWARD_UDP_PORT + iPort),
      } as Config);

      aConfigs.push(config);

      await Genesis.setDeterministicPassphrase(nameNode);
      const passphraseBuf = await Genesis.getDeterministicPassphraseBuf(
        nameNode,
        explicitPassphraseBuf,
      );
      const w: Wallet = await Wallet.make(
        config,
        passphraseBuf || undefined,
        true,
      );

      const publicKey: string = w.getNodePublicKey();
      aPublicKeys.push(publicKey);

      aPeerSeed.push({
        publicKey: publicKey,
        http: w.getHttpAddress(),
        udp: w.getUdpAddress(),
        status: PEER_STATUS_CITIZEN,
        joinedAtEpoch: 0,
      });

      w.close();
    }

    // ==========================================
    // PHASE 2: Build blocks and distribute
    // ==========================================
    const size: number = Math.min(
      BFT_VALIDATORS_SIZE,
      aConfigs.length,
    );
    const initialValidators: Array<ValidatorEntry> = [];

    for (let i = 0; i < size; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      const cfg = aConfigs[i];
      const publicKey = aPublicKeys[i];
      await Genesis.setDeterministicPassphrase(Genesis.getNameNode(i));
      const passphraseBuf = await Genesis.getDeterministicPassphraseBuf(
        nameNode,
        explicitPassphraseBuf,
      );
      const w: Wallet = await Wallet.make(
        cfg,
        passphraseBuf || undefined,
        true,
      );
      initialValidators.push({
        pk: publicKey,
        vrf: w.vrfNode('genesis-seed'),
      });

      w.close();
    }

    const genesisConsensusTemplate: ConsensusBlockStruct = {
      e: 1,
      ha: '',
      p: '0000000000000000000000000000000000000000000',
      cs: [{
        c: COMMAND_VALIDATORS,
        ns: Namespace.initGenesis(),
        d: initialValidators,
      }],
    };
    genesisConsensusTemplate.ha = Util.hash(genesisConsensusTemplate);

    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      const publicKey: string = aPublicKeys[i];
      const cfg: Config = aConfigs[i];

      const _pC: string = joinPath(pathDataReal, nameNode, 'config.json');
      await Deno.writeTextFile(_pC, JSON.stringify(cfg), { mode: 0o400 });

      await Deno.writeTextFile(
        joinPath(pathDataReal, nameNode, 'db', Genesis.NAME_FILE_PEER_SEED),
        JSON.stringify(aPeerSeed),
        { mode: 0o440 },
      );

      if (!bootstrap) {
        const _pGC: string = joinPath(
          pathDataReal,
          nameNode,
          'db',
          Genesis.NAME_FILE_GENESIS_CONSENSUS,
        );
        await Deno.writeTextFile(
          _pGC,
          JSON.stringify(genesisConsensusTemplate),
          {
            mode: 0o440,
          },
        );
        Log.info(`Created ${_pGC}`);
      }

      const genesisSocTemplate: SocBlockStruct = {
        e: 1,
        h: 1,
        ha: '',
        p: '0000000000000000000000000000000000000000000',
        sig: '',
        cs: [{
          c: COMMAND_DATA,
          ns: Namespace.initGenesis(),
          d: publicKey,
        }],
      };
      genesisSocTemplate.ha = Util.hash(genesisSocTemplate);

      const _pGS: string = joinPath(
        pathDataReal,
        nameNode,
        'db',
        Genesis.NAME_FILE_GENESIS_SOC,
      );
      await Deno.writeTextFile(_pGS, JSON.stringify(genesisSocTemplate), {
        mode: 0o440,
      });
      Log.info(`Created ${_pGS}`);
    }
    Log.flush();
  }

  private static getNameNode(i: number): string {
    const n: string = Deno.env.get('NAME_NODE') || Genesis.DEFAULT_NAME_NODE;
    return n + i.toString().padStart(7, '0');
  }

  /**
   * Derives a unique, deterministic passphrase for a specific node
   * using the devnet master seed.
   */
  private static async setDeterministicPassphrase(
    nameNode: string,
  ): Promise<void> {
    const masterSeed: string | undefined = Deno.env.get('DEVNET_MASTER_SEED');
    // In production, this won't run.
    if (!masterSeed) return;

    const data: Uint8Array<ArrayBuffer> = new TextEncoder().encode(
      masterSeed + nameNode,
    );
    const hashBuffer: ArrayBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray: Array<number> = Array.from(new Uint8Array(hashBuffer));
    const passphrase: string = hashArray.map((b) =>
      b.toString(16).padStart(2, '0')
    ).join('');

    Deno.env.set('DIVA_WALLET_PASSPHRASE', passphrase);
  }

  private static async getDeterministicPassphraseBuf(
    nameNode: string,
    explicitPassphraseBuf: Uint8Array | null,
  ): Promise<Uint8Array | null> {
    const masterSeed: string | undefined = Deno.env.get('DEVNET_MASTER_SEED');
    if (!masterSeed) {
      if (!explicitPassphraseBuf) return null;

      const ph: ArrayBuffer = await crypto.subtle.digest(
        'SHA-256',
        new Uint8Array(explicitPassphraseBuf),
      );
      return new Uint8Array(ph);
    }
    const data: Uint8Array<ArrayBuffer> = new TextEncoder().encode(
      masterSeed + nameNode,
    );
    const hashBuffer: ArrayBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray: Uint8Array = new Uint8Array(hashBuffer);

    const hexBuf = new Uint8Array(hashArray.length * 2);
    for (let i = 0; i < hashArray.length; i++) {
      const hex = hashArray[i].toString(16).padStart(2, '0');
      hexBuf[i * 2] = hex.charCodeAt(0);
      hexBuf[i * 2 + 1] = hex.charCodeAt(1);
    }

    const preHashBuffer: Uint8Array = new Uint8Array(
      await crypto.subtle.digest('SHA-256', hexBuf),
    );

    return preHashBuffer;
  }
}
