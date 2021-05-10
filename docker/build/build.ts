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
import { CommandAddPeer } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import { Config } from '../../src/config';
import { Blockchain } from '../../src/chain/blockchain';
import { DEFAULT_NETWORK_SIZE, MAX_NETWORK_SIZE, DEFAULT_BASE_DOMAIN, DEFAULT_BASE_IP, DEFAULT_PORT_P2P } from './main';

export class Build {
  private readonly sizeNetwork: number = DEFAULT_NETWORK_SIZE;
  private readonly pathGenesis: string;
  private readonly pathYml: string;
  private readonly isNameBased: boolean;
  private readonly baseDomain: string;
  private readonly baseIP: string;
  private readonly portP2P: number;
  private readonly hasI2P: boolean;

  constructor(sizeNetwork: number = DEFAULT_NETWORK_SIZE) {
    this.sizeNetwork =
      Math.floor(sizeNetwork) > 0 && Math.floor(sizeNetwork) <= MAX_NETWORK_SIZE
        ? Math.floor(sizeNetwork)
        : DEFAULT_NETWORK_SIZE;
    this.pathGenesis = path.join(__dirname, 'genesis/block.json');
    this.pathYml = path.join(__dirname, 'build-testnet.yml');

    this.isNameBased = Number(process.env.IS_NAME_BASED) > 0;
    this.baseDomain = process.env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN;
    this.baseIP = process.env.BASE_IP || DEFAULT_BASE_IP;
    this.portP2P =
      Number(process.env.PORT_P2P) > 1024 && Number(process.env.PORT_P2P) < 48000
        ? Number(process.env.PORT_P2P)
        : DEFAULT_PORT_P2P;
    this.hasI2P = Number(process.env.HAS_I2P) > 0;

    this.createFiles();
  }

  private getI2PYml(): { c: string; v: string } {
    let container = '';
    let volumes = '';
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const nameI2P = `n${seq}.${this.baseDomain}`;
      container =
        container +
        `  ${nameI2P}:\n` +
        `    container_name: ${nameI2P}\n` +
        '    image: divax/i2p:latest\n' +
        '    restart: unless-stopped\n' +
        '    environment:\n' +
        '      ENABLE_TUNNELS: 1\n' +
        '    volumes:\n' +
        `      - ./tunnels.conf.d/${nameI2P}:/home/i2pd/tunnels.source.conf.d/\n` +
        `      - ${nameI2P}:/home/i2pd/data/\n` +
        '    networks:\n' +
        `      network.${this.baseDomain}:\n` +
        `        ipv4_address: ${this.baseIP}${50 + seq}\n\n`;
      volumes = volumes + `  ${nameI2P}:\n    name: ${nameI2P}\n`;

      const pTunnel = path.join(__dirname, `tunnels.conf.d/${nameI2P}/`);
      fs.mkdirSync(pTunnel, { mode: '755', recursive: true });
      fs.writeFileSync(
        pTunnel + 'testnet.conf',
        '[p2p]\n' +
          'type = server\n' +
          `host = ${this.baseIP}${150 + seq}\n` +
          `port = ${this.portP2P}\n` +
          'gzip = false\n' +
          `keys = ${nameI2P}.p2p.dat\n\n` +
          '[http-api]\n' +
          'type = server\n' +
          `host = ${this.baseIP}${150 + seq}\n` +
          `port = ${this.portP2P + 1}\n` +
          'gzip = false\n' +
          `keys = ${nameI2P}.http-api.dat\n`
      );
    }
    return { c: container, v: volumes };
  }

  private createFiles() {
    // genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../genesis/block.json'));
    const commands: Array<CommandAddPeer> = [];
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const host = this.isNameBased ? `n${seq}.${this.baseDomain}` : `${this.baseIP}${150 + seq}`;
      const config = new Config({
        p2p_ip: host,
        p2p_port: this.portP2P,
        path_keys: path.join(__dirname, 'keys/' + host),
      });

      const pathB32 = path.join(__dirname, `i2p-b32/n${seq}.${this.baseDomain}`);
      let hostP2P = config.p2p_ip;
      let portP2P = config.p2p_port.toString();
      if (this.hasI2P && fs.existsSync(pathB32)) {
        [hostP2P, portP2P] = fs.readFileSync(pathB32).toString().split(':');
      }

      commands.push({
        seq: seq,
        command: 'addPeer',
        host: hostP2P,
        port: Number(portP2P),
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
    const i2p = this.hasI2P ? this.getI2PYml() : { c: '', v: '' };
    let yml = 'version: "3.7"\nservices:\n';
    let volumes = '';
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const hostChain = this.isNameBased ? `n${seq}.${this.baseDomain}` : `${this.baseIP}${150 + seq}`;
      const nameChain = `n${seq}.chain.${this.baseDomain}`;
      yml =
        yml +
        `  ${nameChain}:\n` +
        `    container_name: ${nameChain}\n` +
        '    image: divax/divachain:latest\n' +
        '    restart: unless-stopped\n' +
        '    environment:\n' +
        '      NODE_ENV: development\n' +
        `      HTTP_IP: ${this.baseIP}${150 + seq}\n` +
        `      HTTP_PORT: ${this.portP2P + 1}\n` +
        `      P2P_IP: ${this.baseIP}${150 + seq}\n` +
        `      P2P_PORT: ${this.portP2P}\n` +
        `      SOCKS_PROXY_HOST: ${this.baseIP}${50 + seq}\n` +
        `      SOCKS_PROXY_PORT: ${this.hasI2P ? 4445 : 0}\n` +
        '    volumes:\n' +
        `      - ${nameChain}:/app/\n` +
        `      - ./keys/${hostChain}:/app/keys/\n` +
        '      - ./genesis:/app/genesis/\n' +
        '    networks:\n' +
        `      network.${this.baseDomain}:\n` +
        `        ipv4_address: ${this.baseIP}${150 + seq}\n\n`;
      volumes = volumes + `  ${nameChain}:\n    name: ${nameChain}\n`;
    }

    yml =
      yml +
      i2p.c +
      'networks:\n' +
      `  network.${this.baseDomain}:\n` +
      `    name: network.${this.baseDomain}\n` +
      '    ipam:\n' +
      '      driver: default\n' +
      '      config:\n' +
      `        - subnet: ${this.baseIP}0/24\n\n` +
      'volumes:\n' +
      volumes +
      i2p.v;

    fs.writeFileSync(this.pathYml, yml);
  }
}
