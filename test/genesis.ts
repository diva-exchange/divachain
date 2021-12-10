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

import fs from 'fs';
import path from 'path';
import { BlockStruct } from '../src/chain/block';
import { Blockchain } from '../src/chain/blockchain';
import { CommandAddPeer, CommandModifyStake } from '../src/chain/transaction';
import { Config, DEFAULT_NAME_GENESIS_BLOCK } from '../src/config';
import { Wallet } from '../src/chain/wallet';
import crypto from 'crypto';
import { Util } from '../src/chain/util';

export class Genesis {
  static async create(): Promise<Map<string, Config>> {
    const SIZE_TESTNET = Number(process.env.SIZE_TESTNET || 9);

    const IP = process.env.IP || '127.27.27.1';
    const BASE_PORT = Number(process.env.BASE_PORT || 17000);
    const BASE_PORT_FEED = Number(process.env.BASE_PORT_FEED || 18000);

    const I2P_HTTP_HOST = process.env.I2P_HTTP_HOST || '';
    const I2P_SAM_HTTP_PORT_TCP = I2P_HTTP_HOST ? Number(process.env.I2P_SAM_HTTP_PORT_TCP || 7656) : 0;
    const I2P_UDP_HOST = process.env.I2P_UDP_HOST || '';
    const I2P_SAM_UDP_PORT_TCP = I2P_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_TCP || 7656) : 0;
    const I2P_SAM_UDP_PORT_UDP = I2P_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_UDP || 7655) : 0;
    const I2P_SAM_FORWARD_HTTP_HOST = I2P_HTTP_HOST ? process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1' : '';
    const I2P_SAM_FORWARD_HTTP_PORT = I2P_HTTP_HOST ? Number(process.env.I2P_SAM_FORWARD_HTTP_PORT || BASE_PORT) : 0;
    const I2P_SAM_FORWARD_UDP_HOST = I2P_UDP_HOST ? process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1' : '';
    const I2P_SAM_FORWARD_UDP_PORT = I2P_UDP_HOST ? Number(process.env.I2P_SAM_FORWARD_UDP_PORT || 19000) : 0;

    const pathGenesis = path.join(__dirname, './genesis', DEFAULT_NAME_GENESIS_BLOCK) + '.json';
    let genesis: BlockStruct;
    if (!fs.existsSync(pathGenesis) || !fs.existsSync(pathGenesis + '.config')) {
      genesis = Blockchain.genesis(path.join(__dirname, '../genesis/block.json'));
      fs.writeFileSync(pathGenesis, JSON.stringify(genesis));
    } else {
      fs.rmdirSync(__dirname + '/blockstore', { recursive: true });
      fs.rmdirSync(__dirname + '/state', { recursive: true });
      fs.mkdirSync(__dirname + '/blockstore');
      fs.mkdirSync(__dirname + '/state');
      fs.copyFileSync(__dirname + '/../blockstore/.gitignore', __dirname + '/blockstore/.gitignore');
      fs.copyFileSync(__dirname + '/../state/.gitignore', __dirname + '/state/.gitignore');
      return Promise.resolve(new Map(JSON.parse(fs.readFileSync(pathGenesis + '.config').toString())));
    }

    const map = new Map();
    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let s = 1;
    let config = {} as Config;
    for (let i = 1; i <= SIZE_TESTNET; i++) {
      config = await Config.make({
        no_bootstrapping: 1,
        ip: IP,
        port: BASE_PORT + i,
        port_block_feed: BASE_PORT_FEED + i,
        path_genesis: pathGenesis,
        path_state: path.join(__dirname, './state'),
        path_blockstore: path.join(__dirname, './blockstore'),
        path_keys: path.join(__dirname, './keys'),
        blockchain_max_blocks_in_memory: 100,
        i2p_sam_http_host: I2P_HTTP_HOST,
        i2p_sam_http_port_tcp: I2P_SAM_HTTP_PORT_TCP,
        i2p_sam_udp_host: I2P_UDP_HOST,
        i2p_sam_udp_port_tcp: I2P_SAM_UDP_PORT_TCP,
        i2p_sam_udp_port_udp: I2P_SAM_UDP_PORT_UDP,
        i2p_sam_forward_http_host: I2P_SAM_FORWARD_HTTP_HOST,
        i2p_sam_forward_http_port: I2P_SAM_FORWARD_HTTP_PORT > 0 ? I2P_SAM_FORWARD_HTTP_PORT + i : 0,
        i2p_sam_forward_udp_host: I2P_SAM_FORWARD_UDP_HOST,
        i2p_sam_forward_udp_port: I2P_SAM_FORWARD_UDP_PORT > 0 ? I2P_SAM_FORWARD_UDP_PORT + i : 0,
        http: I2P_HTTP_HOST ? '' : `${IP}:${BASE_PORT + i}`,
        udp: I2P_UDP_HOST ? '' : `${IP}:${BASE_PORT + 3000 + i}`,
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

    fs.writeFileSync(pathGenesis, JSON.stringify(genesis));
    fs.writeFileSync(pathGenesis + '.config', JSON.stringify([...map]), { mode: '0600' });

    return Promise.resolve(map);
  }
}
