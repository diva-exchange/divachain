/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { exists } from '@std/fs';
import fs from 'node:fs';
import { join as joinPath } from 'node:path';
import type { TxStruct } from './chain/tx.ts';
import {
  Config,
  DEFAULT_I2P_SAM_FORWARD_HTTP_PORT,
  DEFAULT_I2P_SAM_FORWARD_UDP_PORT,
  DEFAULT_I2P_SAM_HTTP_PORT,
  DEFAULT_I2P_SAM_LISTEN_UDP_PORT,
  DEFAULT_I2P_SAM_UDP_PORT,
  DEFAULT_I2P_SOCKS_PORT,
  DEFAULT_IP,
  DEFAULT_NAME_GENESIS,
  DEFAULT_PORT,
  DEFAULT_PORT_TX_FEED,
} from './config.ts';
import { Wallet } from './chain/wallet.ts';
import { Util } from './chain/util.ts';
import { Chain, Peer } from './chain/chain.ts';
import { Log } from './logger.ts';

enum typeNet {
  dev = 1,
  test,
}

export class Genesis {
  private static readonly DEFAULT_SIZE_TESTNETWORK: number = 7;
  private static readonly MAX_NETWORK_SIZE: number = 128;
  private static readonly DEFAULT_NAME_NODE: string = 'n';
  private static readonly NAME_FILE_GENESIS: string = 'genesis.json';
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
      SIZE_NETWORK = SIZE_NETWORK > 0
        ? SIZE_NETWORK
        : (isTestnet ? Genesis.DEFAULT_SIZE_TESTNETWORK : 1);
      if (SIZE_NETWORK > Genesis.MAX_NETWORK_SIZE) {
        Log.fatal(`Fatal, SIZE_NETWORK must be <=${Genesis.MAX_NETWORK_SIZE}`);
        Deno.exit(1);
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
    // check
    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      const pTest = joinPath(pathApp, pathDataRelative, nameNode);
      if (await exists(pTest)) {
        Log.fatal(`Fatal, path exists: ${pTest}`);
        Deno.exit(1);
      }
    }

    const pathSeedGenesis: string = joinPath(
      pathApp,
      'seed-genesis',
      DEFAULT_NAME_GENESIS + '.json',
    );
    let genesis: TxStruct = await Chain.genesis(pathSeedGenesis);

    const IP: string = Deno.env.get('IP') || DEFAULT_IP;
    const PORT: number = Number(Deno.env.get('PORT') || DEFAULT_PORT);
    const PORT_TX_FEED: number = Number(
      Deno.env.get('PORT_TX_FEED') || DEFAULT_PORT_TX_FEED,
    );

    const I2P_SOCKS: string = Deno.env.get('I2P_SOCKS') ||
      IP + ':' + DEFAULT_I2P_SOCKS_PORT;
    const I2P_SAM_HTTP: string = Deno.env.get('I2P_SAM_HTTP') ||
      IP + ':' + DEFAULT_I2P_SAM_HTTP_PORT;

    let _a: Array<string> = (Deno.env.get('I2P_SAM_FORWARD_HTTP') ||
      IP + ':' + DEFAULT_I2P_SAM_FORWARD_HTTP_PORT).split(
        ':',
      );
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
    let config: Config = {} as Config;
    let pathDB: string = '';
    let pathKeys: string = '';
    let pathGenesis: string = '';
    let pathPeerSeed: string = '';
    let pathLog: string = '';

    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      pathDB = joinPath(pathDataRelative, nameNode, 'db');
      fs.mkdirSync(joinPath(pathApp, pathDB, 'chain'), { recursive: true });
      fs.mkdirSync(joinPath(pathApp, pathDB, 'state'));

      pathGenesis = joinPath(pathDB, Genesis.NAME_FILE_GENESIS);
      await Deno.writeTextFile(
        joinPath(pathApp, pathGenesis),
        JSON.stringify({}),
      );

      pathPeerSeed = joinPath(pathDB, Genesis.NAME_FILE_PEER_SEED);
      await Deno.writeTextFile(
        joinPath(pathApp, pathPeerSeed),
        JSON.stringify([]),
      );

      pathKeys = joinPath(pathDataRelative, nameNode, 'keys');
      fs.mkdirSync(joinPath(pathApp, pathKeys));

      pathLog = joinPath(pathDataRelative, nameNode, 'log');
      fs.mkdirSync(joinPath(pathApp, pathLog));

      const iPort: number = i * 10;
      config = await Config.make({
        is_testnet: isTestnet,
        bootstrap: bootstrap,
        ip: IP,
        port: PORT + iPort,
        port_tx_feed: PORT_TX_FEED + iPort,
        path_genesis: pathGenesis,
        path_peer_seed: pathPeerSeed,
        path_chain: joinPath(pathDB, 'chain'),
        path_state: joinPath(pathDB, 'state'),
        path_keys: pathKeys,
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
      const _pC: string = joinPath(pathDataReal, nameNode, 'config.json');
      await Deno.writeTextFile(_pC, JSON.stringify(config), { mode: 0o400 });

      const publicKey: string = Wallet.make(config).getPublicKey();
      aPeerSeed.push({
        publicKey: publicKey,
        http: config.http,
        udp: config.udp,
      });

      genesis = {
        v: genesis.v,
        h: genesis.h,
        o: publicKey,
        ha: genesis.ha,
        p: genesis.p,
        cs: genesis.cs,
      };
      genesis.ha = Util.hash(genesis);
      const _pG: string = joinPath(
        pathDataReal,
        nameNode,
        'db',
        Genesis.NAME_FILE_GENESIS,
      );
      await Deno.writeTextFile(_pG, JSON.stringify(genesis), { mode: 0o440 });
      Log.info(`Created ${_pG}`);
    }

    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = Genesis.getNameNode(i);
      await Deno.writeTextFile(
        joinPath(pathDataReal, nameNode, 'db', Genesis.NAME_FILE_PEER_SEED),
        JSON.stringify(aPeerSeed),
        { mode: 0o440 },
      );
    }

    Log.flush();
  }

  private static getNameNode(i: number): string {
    const n: string = Deno.env.get('NAME_NODE') || Genesis.DEFAULT_NAME_NODE;
    return n + i.toString().padStart(7, '0');
  }
}
