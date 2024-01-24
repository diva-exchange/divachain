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
import {
  Config,
  DEFAULT_IP,
  DEFAULT_PORT,
  DEFAULT_TX_FEED_PORT,
  DEFAULT_I2P_SOCKS_PORT,
  DEFAULT_I2P_SAM_TCP_PORT,
  DEFAULT_I2P_SAM_UDP_PORT,
  DEFAULT_NAME_GENESIS,
  MAX_NETWORK_SIZE,
} from './config.js';
import { Wallet } from './chain/wallet.js';
import { Util } from './chain/util.js';
import { Chain } from './chain/chain.js';

export class Genesis {
  static async create(pathApplication: string = ''): Promise<{ genesis: TxStruct; config: Array<any> }> {
    process.env.GENESIS = '0';

    const SIZE_NETWORK: number = Number(process.env.SIZE_NETWORK || 9);
    if (SIZE_NETWORK > MAX_NETWORK_SIZE) {
      throw new Error(`Fatal: maximum network size of ${MAX_NETWORK_SIZE} nodes exceeded.`);
    }

    const IP: string = process.env.IP || DEFAULT_IP;
    const BASE_PORT: number = Number(process.env.BASE_PORT || DEFAULT_PORT);
    const BASE_PORT_FEED: number = Number(process.env.BASE_PORT_FEED || DEFAULT_TX_FEED_PORT);

    const I2P_SOCKS: string = process.env.I2P_SOCKS || IP + ':' + DEFAULT_I2P_SOCKS_PORT;
    const I2P_SAM_HTTP: string = process.env.I2P_SAM_HTTP || IP + ':' + DEFAULT_I2P_SAM_TCP_PORT;
    const I2P_SAM_UDP: string = process.env.I2P_SAM_UDP_HOST || IP + ':' + DEFAULT_I2P_SAM_UDP_PORT;

    const ___dirname: string = path.dirname(import.meta.url.replace(/^file:\/\//, ''));
    const pathApp: string = pathApplication || path.join(___dirname, '/../');

    const pathGenesis: string = path.join(___dirname, '/../genesis', DEFAULT_NAME_GENESIS + '.json');
    let genesis: TxStruct = Chain.genesis(pathGenesis);

    const arrayConfig: Array<Config> = [];
    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let config: Config = {} as Config;
    for (let i = 1; i <= SIZE_NETWORK; i++) {
      const iPort: number = i * MAX_NETWORK_SIZE;
      config = await Config.make({
        no_bootstrapping: 1,
        ip: IP,
        port: BASE_PORT + iPort,
        port_tx_feed: BASE_PORT_FEED + iPort,
        path_app: pathApp,
        path_genesis: pathGenesis,
        i2p_socks: I2P_SOCKS,
        i2p_sam_http: I2P_SAM_HTTP,
        i2p_sam_udp: I2P_SAM_UDP,
      });

      const publicKey: string = Wallet.make(config).getPublicKey();
      arrayConfig.push(config);

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

    return Promise.resolve({ genesis: genesis, config: arrayConfig });
  }
}
