/**
 * Copyright (C) 2021-2024 diva.exchange
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

import path from 'path';
import { CommandAddPeer, CommandModifyStake, TxStruct } from './chain/tx.js';
import { Config, DEFAULT_NAME_GENESIS, MAX_NETWORK_SIZE } from './config.js';
import { Wallet } from './chain/wallet.js';
import { Util } from './chain/util.js';
import { Chain } from './chain/chain.js';

export class Genesis {
  static async create(pathApplication: string = ''): Promise<{ genesis: TxStruct; config: Array<any> }> {
    process.env.GENESIS = '0';

    const SIZE_NETWORK: number = Number(process.env.SIZE_NETWORK || 11);
    if (SIZE_NETWORK > MAX_NETWORK_SIZE) {
      throw new Error(`Fatal: maximum network size of ${MAX_NETWORK_SIZE} nodes exceeded.`);
    }

    const IP: string = process.env.IP || '127.27.27.1';
    const BASE_PORT: number = Number(process.env.BASE_PORT || 17000);
    const BASE_PORT_FEED: number = Number(process.env.BASE_PORT_FEED || 18000);

    const I2P_SOCKS_HOST: string = process.env.I2P_SOCKS_HOST || '';
    const I2P_SOCKS_PORT: number = I2P_SOCKS_HOST ? Number(process.env.I2P_SOCKS_PORT || 4445) : 0;

    const I2P_SAM_HTTP_HOST: string = process.env.I2P_SAM_HTTP_HOST || I2P_SOCKS_HOST;
    const I2P_SAM_HTTP_PORT: number = I2P_SAM_HTTP_HOST ? Number(process.env.I2P_SAM_HTTP_PORT || 7656) : 0;
    const I2P_SAM_FORWARD_HTTP_HOST: string = I2P_SAM_HTTP_HOST
      ? process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1'
      : '';
    const I2P_SAM_FORWARD_HTTP_PORT: number = I2P_SAM_HTTP_HOST
      ? Number(process.env.I2P_SAM_FORWARD_HTTP_PORT || BASE_PORT)
      : 0;

    const I2P_SAM_UDP_HOST: string = process.env.I2P_SAM_UDP_HOST || I2P_SOCKS_HOST;
    const I2P_SAM_UDP_PORT: number = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT || 7656) : 0;
    const I2P_SAM_LISTEN_UDP_HOST: string = I2P_SAM_UDP_HOST ? process.env.I2P_SAM_LISTEN_UDP_HOST || '0.0.0.0' : '';
    const I2P_SAM_LISTEN_UDP_PORT: number = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_LISTEN_UDP_PORT || 20000) : 0;
    const I2P_SAM_FORWARD_UDP_HOST: string = I2P_SAM_UDP_HOST
      ? process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1'
      : '';
    const I2P_SAM_FORWARD_UDP_PORT: number = I2P_SAM_UDP_HOST
      ? Number(process.env.I2P_SAM_FORWARD_UDP_PORT || 20000)
      : 0;

    const ___dirname: string = path.dirname(import.meta.url.replace(/^file:\/\//, ''));
    const pathApp: string = pathApplication || path.join(___dirname, '/../');

    const pathGenesis: string = path.join(___dirname, '/../genesis', DEFAULT_NAME_GENESIS + '.json');
    let genesis: TxStruct = Chain.genesis(pathGenesis);

    const map: Map<any, any> = new Map();
    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let config: Config = {} as Config;
    for (let i = 1; i <= SIZE_NETWORK; i++) {
      config = await Config.make({
        no_bootstrapping: 1,
        ip: IP,
        port: BASE_PORT + i,
        port_tx_feed: BASE_PORT_FEED + i,
        path_app: pathApp,
        path_genesis: pathGenesis,
        chain_max_txs_in_memory: 100,
        i2p_socks: I2P_SOCKS_HOST + ':' + I2P_SOCKS_PORT,
        i2p_sam_http: I2P_SAM_HTTP_HOST + ':' + I2P_SAM_HTTP_PORT,
        http: I2P_SAM_HTTP_HOST ? '' : `${IP}:${BASE_PORT + i}`,
        i2p_sam_forward_http:
          I2P_SAM_FORWARD_HTTP_HOST + ':' + (I2P_SAM_FORWARD_HTTP_PORT > 0 ? I2P_SAM_FORWARD_HTTP_PORT + i : 0),
        i2p_sam_udp: I2P_SAM_UDP_HOST + ':' + I2P_SAM_UDP_PORT,
        i2p_sam_listen_udp:
          I2P_SAM_LISTEN_UDP_HOST + ':' + (I2P_SAM_LISTEN_UDP_PORT > 0 ? I2P_SAM_LISTEN_UDP_PORT + i : 0),
        i2p_sam_forward_udp:
          I2P_SAM_FORWARD_UDP_HOST + ':' + (I2P_SAM_FORWARD_UDP_PORT > 0 ? I2P_SAM_FORWARD_UDP_PORT + i : 0),
        udp: I2P_SAM_UDP_HOST ? '' : `${IP}:${BASE_PORT + 3000 + i}`,
      });

      const publicKey: string = Wallet.make(config).getPublicKey();
      map.set(publicKey, config);

      cmds.push({
        command: 'addPeer',
        http: config.http,
        udp: config.udp,
        publicKey: publicKey,
      } as CommandAddPeer);
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

    return Promise.resolve({ genesis: genesis, config: [...map] });
  }
}
