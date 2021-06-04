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
import { DEFAULT_NETWORK_SIZE, MAX_NETWORK_SIZE, DEFAULT_BASE_DOMAIN, DEFAULT_BASE_IP, DEFAULT_PORT } from './main';

export class Build {
  private readonly sizeNetwork: number = DEFAULT_NETWORK_SIZE;
  private readonly pathGenesis: string;
  private readonly pathYml: string;
  private readonly isNameBased: boolean;
  private readonly baseDomain: string;
  private readonly baseIP: string;
  private readonly port: number;
  private readonly hasI2P: boolean;
  private readonly envNode: string;
  private readonly levelLog: string;
  private readonly networkSyncThreshold: number;
  private readonly networkVerboseLogging: boolean;

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
    this.port =
      Number(process.env.PORT) > 1024 && Number(process.env.PORT) < 48000 ? Number(process.env.PORT) : DEFAULT_PORT;
    this.hasI2P = Number(process.env.HAS_I2P) > 0;
    this.networkSyncThreshold =
      Number(process.env.NETWORK_SYNC_THRESHOLD) > 0 ? Number(process.env.NETWORK_SYNC_THRESHOLD) : 1;
    this.networkVerboseLogging = Number(process.env.NETWORK_VERBOSE_LOGGING) > 0;
    this.envNode = this.networkVerboseLogging || process.env.NODE_ENV === 'development' ? 'development' : 'production';
    this.levelLog = process.env.LOG_LEVEL || 'warn';

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
        '[p2p-api]\n' +
          'type = server\n' +
          `host = ${this.baseIP}${150 + seq}\n` +
          `port = ${this.port}\n` +
          'gzip = false\n' +
          `keys = ${nameI2P}.p2p-api.dat\n`
      );
    }
    return { c: container, v: volumes };
  }

  private createFiles() {
    // genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../genesis/block.json'));
    const commands: Array<CommandAddPeer> = [];
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      let host = this.isNameBased ? `n${seq}.${this.baseDomain}` : `${this.baseIP}${150 + seq}`;
      const config = new Config({
        ip: host,
        port: this.port,
        path_keys: path.join(__dirname, 'keys/' + host),
      });

      const pathB32 = path.join(__dirname, `i2p-b32/n${seq}.${this.baseDomain}`);
      host = config.ip;
      let port = config.port.toString();
      if (this.hasI2P && fs.existsSync(pathB32)) {
        config.address = fs.readFileSync(pathB32).toString().trim();
        [host, port] = config.address.split(':');
      }

      commands.push({
        seq: seq,
        command: 'addPeer',
        host: host,
        port: Number(port),
        publicKey: Wallet.make(config).getPublicKey(),
      });
    }

    genesis.tx = [
      {
        ident: 'genesis',
        origin: '0000000000000000000000000000000000000000000',
        timestamp: 88355100000,
        commands: commands,
        sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      },
    ];

    fs.writeFileSync(this.pathGenesis, JSON.stringify(genesis));

    // docker compose Yml file
    const i2p = this.hasI2P ? this.getI2PYml() : { c: '', v: '' };
    let yml = 'version: "3.7"\nservices:\n';
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const hostChain = this.isNameBased ? `n${seq}.${this.baseDomain}` : `${this.baseIP}${150 + seq}`;
      const nameChain = `n${seq}.chain.${this.baseDomain}`;
      let proxy = '';
      if (this.hasI2P) {
        proxy =
          `      I2P_SOCKS_PROXY_HOST: ${this.baseIP}${50 + seq}\n` +
          '      I2P_SOCKS_PROXY_PORT: 4445\n      I2P_SOCKS_PROXY_CONSOLE_PORT: 7070\n';
      }
      yml =
        yml +
        `  ${nameChain}:\n` +
        `    container_name: ${nameChain}\n` +
        '    image: divax/divachain:latest\n' +
        '    restart: unless-stopped\n' +
        '    environment:\n' +
        `      NODE_ENV: ${this.envNode}\n` +
        `      LOG_LEVEL: ${this.levelLog}\n` +
        `      IP: ${this.baseIP}${150 + seq}\n` +
        `      PORT: ${this.port}\n` +
        proxy +
        `      NETWORK_SYNC_THRESHOLD: ${this.networkSyncThreshold}\n` +
        `      NETWORK_VERBOSE_LOGGING: ${this.networkVerboseLogging ? 1 : 0}\n` +
        '    volumes:\n' +
        `      - ./keys/${hostChain}:/keys/\n` +
        '      - ./genesis:/genesis/\n' +
        '    networks:\n' +
        `      network.${this.baseDomain}:\n` +
        `        ipv4_address: ${this.baseIP}${150 + seq}\n\n`;
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
      (i2p.v ? 'volumes:\n' + i2p.v : '');

    fs.writeFileSync(this.pathYml, yml);
  }
}
