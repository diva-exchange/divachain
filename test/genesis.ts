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
    const BASE_PORT = Number(process.env.BASE_PORT || 17000);
    const BASE_PORT_FEED = Number(process.env.BASE_PORT_FEED || 18000);
    const IP = process.env.IP || '127.27.27.1';
    const HAS_I2P = Number(process.env.HAS_I2P) > 0 || false;
    const I2P_HOST = HAS_I2P ? process.env.I2P_HOST || '172.19.75.11' : '';
    const I2P_SOCKS_PORT = HAS_I2P ? Number(process.env.I2P_SOCKS_PORT || 4445) : 0;
    const I2P_SAM_PORT_TCP = HAS_I2P ? Number(process.env.I2P_SAM_PORT_TCP || 7656) : 0;
    const I2P_SAM_FORWARD_HOST = process.env.I2P_SAM_FORWARD_HOST || '172.19.75.1';
    const I2P_SAM_FORWARD_PORT = Number(process.env.I2P_SAM_FORWARD_PORT || 19000);
    const TCP_SERVER_IP = process.env.TCP_SERVER_IP || '0.0.0.0';
    const TCP_SERVER_PORT = Number(process.env.TCP_SERVER_PORT || I2P_SAM_FORWARD_PORT);

    const map = new Map();
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../genesis/block.json'));
    const pathGenesis = path.join(__dirname, './genesis', DEFAULT_NAME_GENESIS_BLOCK) + '.json';
    fs.writeFileSync(pathGenesis, JSON.stringify(genesis));

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
        i2p_socks_host: I2P_HOST,
        i2p_socks_port: I2P_SOCKS_PORT,
        i2p_sam_host: I2P_HOST,
        i2p_sam_port_tcp: I2P_SAM_PORT_TCP,
        i2p_sam_forward_host: I2P_SAM_FORWARD_HOST,
        i2p_sam_forward_port: I2P_SAM_FORWARD_PORT + i,
        tcp_server_ip: TCP_SERVER_IP,
        tcp_server_port: TCP_SERVER_PORT + i,
        address: HAS_I2P ? '' : `${IP}:${BASE_PORT + i}`,
      });

      const publicKey = Wallet.make(config).getPublicKey();
      map.set(publicKey, config);

      cmds.push({
        seq: s,
        command: 'addPeer',
        address: config.address,
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

    return Promise.resolve(map);
  }
}
