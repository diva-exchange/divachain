/**
 * Copyright (C) 2021 diva.exchange
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
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import path from 'path';
import { BlockStruct } from './chain/block';
import { Blockchain } from './chain/blockchain';
import { CommandAddPeer, CommandModifyStake } from './chain/transaction';
import { Config, DEFAULT_NAME_GENESIS_BLOCK } from './config';
import { Wallet } from './chain/wallet';
import crypto from 'crypto';
import { Util } from './chain/util';

export class Genesis {
  static async create(pathApplication = ''): Promise<{ genesis: BlockStruct; config: Array<any> }> {
    process.env.GENESIS = '0';

    const SIZE_NETWORK = Number(process.env.SIZE_NETWORK || 9);

    const IP = process.env.IP || '127.27.27.1';
    const BASE_PORT = Number(process.env.BASE_PORT || 17000);
    const BASE_PORT_FEED = Number(process.env.BASE_PORT_FEED || 18000);

    const I2P_SOCKS_HOST = process.env.I2P_SOCKS_HOST || '';
    const I2P_SOCKS_PORT = I2P_SOCKS_HOST ? Number(process.env.I2P_SOCKS_PORT || 4445) : 0;
    const I2P_SAM_HTTP_HOST = process.env.I2P_SAM_HTTP_HOST || I2P_SOCKS_HOST;
    const I2P_SAM_HTTP_PORT_TCP = I2P_SAM_HTTP_HOST ? Number(process.env.I2P_SAM_HTTP_PORT_TCP || 7656) : 0;
    const I2P_SAM_UDP_HOST = process.env.I2P_SAM_UDP_HOST || I2P_SAM_HTTP_HOST;
    const I2P_SAM_UDP_PORT_TCP = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_TCP || 7656) : 0;
    const I2P_SAM_UDP_PORT_UDP = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_UDP || 7655) : 0;
    const I2P_SAM_FORWARD_HTTP_HOST = I2P_SAM_HTTP_HOST ? process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1' : '';
    const I2P_SAM_FORWARD_HTTP_PORT = I2P_SAM_HTTP_HOST ? Number(process.env.I2P_SAM_FORWARD_HTTP_PORT || BASE_PORT) : 0;
    const I2P_SAM_LISTEN_UDP_HOST = I2P_SAM_UDP_HOST ? process.env.I2P_SAM_LISTEN_UDP_HOST || '0.0.0.0' : '';
    const I2P_SAM_LISTEN_UDP_PORT = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_LISTEN_UDP_PORT || 19000) : 0;
    const I2P_SAM_FORWARD_UDP_HOST = I2P_SAM_UDP_HOST ? process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1' : '';
    const I2P_SAM_FORWARD_UDP_PORT = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_FORWARD_UDP_PORT || 19000) : 0;

    const pathApp = pathApplication || path.join(__dirname, '/../');

    const pathGenesis = path.join(__dirname, '/../genesis', DEFAULT_NAME_GENESIS_BLOCK + '.json');
    const genesis: BlockStruct = Blockchain.genesis(pathGenesis);

    const map = new Map();
    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let s = 1;
    let config = {} as Config;
    for (let i = 1; i <= SIZE_NETWORK; i++) {
      config = await Config.make({
        no_bootstrapping: 1,
        ip: IP,
        port: BASE_PORT + i,
        port_block_feed: BASE_PORT_FEED + i,
        path_app: pathApp,
        path_genesis: pathGenesis,
        blockchain_max_blocks_in_memory: 100,
        i2p_socks_host: I2P_SOCKS_HOST,
        i2p_socks_port: I2P_SOCKS_PORT,
        i2p_sam_http_host: I2P_SAM_HTTP_HOST,
        i2p_sam_http_port_tcp: I2P_SAM_HTTP_PORT_TCP,
        i2p_sam_udp_host: I2P_SAM_UDP_HOST,
        i2p_sam_udp_port_tcp: I2P_SAM_UDP_PORT_TCP,
        i2p_sam_udp_port_udp: I2P_SAM_UDP_PORT_UDP,
        i2p_sam_forward_http_host: I2P_SAM_FORWARD_HTTP_HOST,
        i2p_sam_forward_http_port: I2P_SAM_FORWARD_HTTP_PORT > 0 ? I2P_SAM_FORWARD_HTTP_PORT + i : 0,
        i2p_sam_listen_udp_host: I2P_SAM_LISTEN_UDP_HOST,
        i2p_sam_listen_udp_port: I2P_SAM_LISTEN_UDP_PORT > 0 ? I2P_SAM_LISTEN_UDP_PORT + i : 0,
        i2p_sam_forward_udp_host: I2P_SAM_FORWARD_UDP_HOST,
        i2p_sam_forward_udp_port: I2P_SAM_FORWARD_UDP_PORT > 0 ? I2P_SAM_FORWARD_UDP_PORT + i : 0,
        http: I2P_SAM_HTTP_HOST ? '' : `${IP}:${BASE_PORT + i}`,
        udp: I2P_SAM_UDP_HOST ? '' : `${IP}:${BASE_PORT + 3000 + i}`,
      });

      const publicKey = Wallet.make(config).getPublicKey();
      map.set(publicKey, config);

      cmds.push({
        seq: s,
        command: 'addPeer',
        http: config.http,
        udp: config.udp,
        publicKey: publicKey,
      } as CommandAddPeer);
      s++;
      cmds.push({
        seq: s,
        command: 'modifyStake',
        publicKey: publicKey,
        stake: Math.floor(crypto.randomInt(1, 1000) / Math.sqrt(i)),
      } as CommandModifyStake);
      s++;
    }
    genesis.tx = [
      {
        ident: 'genesis',
        origin: '0000000000000000000000000000000000000000000',
        commands: cmds,
        sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      },
    ];
    genesis.hash = Util.hash(genesis.previousHash + genesis.version + genesis.height + JSON.stringify(genesis.tx));

    return Promise.resolve({ genesis: genesis, config: [...map] });
  }
}
