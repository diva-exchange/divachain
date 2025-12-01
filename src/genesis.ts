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
import type { CommandAddPeer, TxStruct } from './chain/tx.ts';
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
import { Chain } from './chain/chain.ts';
import { Log } from './logger.ts';

const DEFAULT_SIZE_TESTNETWORK: number = 7;

enum typeNet {
  dev = 1,
  test,
}

export class Genesis {
  static async create(type: typeNet = typeNet.dev) {
    const isTestnet: boolean = (Deno.env.get('IS_TESTNET') || 0) == '1';

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
    await exists(pathDataReal) &&
      fs.rmSync(pathDataReal, { recursive: true, force: true });
    !(await exists(pathDataReal)) && fs.mkdirSync(pathDataReal);

    const pathSeedGenesis: string = joinPath(
      pathApp,
      'seed-genesis',
      DEFAULT_NAME_GENESIS + '.json',
    );
    let genesis: TxStruct = Chain.genesis(pathSeedGenesis);

    const SIZE_NETWORK: number = isTestnet ? DEFAULT_SIZE_TESTNETWORK : 1;
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

    const cmds: Array<CommandAddPeer> = [];
    let config: Config = {} as Config;
    let pathDB: string = '';
    let pathKeys: string = '';
    let pathGenesis: string = '';
    let pathLog: string = '';
    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = 'n' + i.toString().padStart(7, '0');
      pathDB = joinPath(pathDataRelative, nameNode, 'db');
      fs.mkdirSync(joinPath(pathApp, pathDB, 'chain'), { recursive: true });
      fs.mkdirSync(joinPath(pathApp, pathDB, 'state'));

      pathGenesis = joinPath(pathDB, 'genesis.json');
      fs.writeFileSync(joinPath(pathApp, pathGenesis), JSON.stringify({}));

      pathKeys = joinPath(pathDataRelative, nameNode, 'keys');
      fs.mkdirSync(joinPath(pathApp, pathKeys));

      pathLog = joinPath(pathDataRelative, nameNode, 'log');
      fs.mkdirSync(joinPath(pathApp, pathLog));

      const iPort: number = i * 10;
      config = await Config.make({
        no_bootstrapping: true,
        debug_performance: true,
        ip: IP,
        port: PORT + iPort,
        port_tx_feed: PORT_TX_FEED + iPort,
        path_genesis: pathGenesis,
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

      const publicKey: string = Wallet.make(config).getPublicKey();

      cmds.push({
        command: 'addPeer',
        http: config.http,
        udp: config.udp,
        publicKey: publicKey,
      } as CommandAddPeer);

      const _p: string = joinPath(pathDataReal, nameNode, 'config.json');
      fs.writeFileSync(_p, JSON.stringify(config), { mode: 0o440 });
      Log.trace(`Genesis: created config ${_p}`);
    }

    genesis = {
      v: genesis.v,
      height: 1,
      prev: '0000000000000000000000000000000000000000000',
      hash: '0000000000000000000000000000000000000000000',
      origin: '0000000000000000000000000000000000000000000',
      commands: cmds,
      votes: genesis.votes,
    };
    genesis.hash = Util.hash(genesis);

    for (let i = 0; i < SIZE_NETWORK; i++) {
      const nameNode: string = 'n' + i.toString().padStart(7, '0');
      fs.writeFileSync(
        joinPath(pathDataReal, nameNode, 'db', 'genesis.json'),
        JSON.stringify(genesis),
      );
    }
  }
}
