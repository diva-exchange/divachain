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
import { BlockStruct } from '../../src/chain/block';
import { ArrayComand } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import { Config } from '../../src/config';
import { Blockchain } from '../../src/chain/blockchain';

const SIZE_NETWORK_DEFAULT = 7;

export class Prepare {
  private readonly sizeNetwork: number = SIZE_NETWORK_DEFAULT;
  private readonly pathGenesis: string;
  private readonly pathYml: string;

  constructor(sizeNetwork: number = SIZE_NETWORK_DEFAULT) {
    this.sizeNetwork = Math.floor(sizeNetwork) > 0 ? Math.floor(sizeNetwork) : SIZE_NETWORK_DEFAULT;
    this.pathGenesis = path.join(__dirname, 'genesis/genesis.json');
    this.pathYml = path.join(__dirname, 'docker/chain-testnet.yml');

    this.createFiles();
  }

  private createFiles() {
    // genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../src/genesis.json'));
    const commands: ArrayComand = [];
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const config = new Config({
        p2p_ip: '172.20.72.' + (100 + seq),
        p2p_port: 17468,
        path_keys: path.join(__dirname, 'keys'),
      });

      commands.push({
        seq: seq,
        command: 'addPeer',
        host: config.p2p_ip,
        port: config.p2p_port,
        publicKey: new Wallet(config).getPublicKey(),
      });
    }

    genesis.tx = [
      {
        ident: 'genesis',
        origin: '1234567890123456789012345678901234567890123',
        timestamp: 88355100000,
        commands: commands,
        sig: '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
      },
    ];

    fs.writeFileSync(this.pathGenesis, JSON.stringify(genesis));

    // docker compose Yml file
    let yml = 'version: "3.7"\nservices:\n';
    let volumes = '';
    let seq = 1;
    for (const c of commands) {
      const name = `n${seq}.chain.testnet.diva.performance`;
      yml = yml +
        `  ${name}:\n` +
        `    container_name: ${name}\n` +
        '    image: divax/divachain:latest\n' +
        '    restart: unless-stopped\n' +
        '    environment:\n' +
        '      NODE_ENV: development\n' +
        '      HTTP_IP: 172.20.72.' + (100 + seq) + '\n' +
        '      HTTP_PORT: 17469\n' +
        '      P2P_IP: 172.20.72.' + (100 + seq) + '\n' +
        '      P2P_PORT: 17468\n' +
        '    volumes:\n' +
        `      - ${name}:/app/\n` +
        '      - ../keys:/app/keys/\n' +
        '    networks:\n' +
        '      network.testnet.diva.performance:\n' +
        '        ipv4_address: 172.20.72.' + (100 + seq) + '\n\n';
      volumes = volumes +
        `  ${name}:\n` +
        `    name: ${name}\n`;
      seq++;
    }

    yml = yml +
      'networks:\n' +
      '  network.testnet.diva.performance:\n' +
      '    name: network.testnet.diva.performance\n' +
      '    ipam:\n' +
      '      driver: default\n' +
      '      config:\n' +
      '        - subnet: 172.20.72.0/24\n\n' +
      'volumes:\n' + volumes;

    fs.writeFileSync(this.pathYml, yml);
  }
}
