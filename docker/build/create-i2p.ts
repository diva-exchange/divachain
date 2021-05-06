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
import { DEFAULT_NETWORK_SIZE, MAX_NETWORK_SIZE, DEFAULT_BASE_IP, DEFAULT_PORT_P2P, DEFAULT_BASE_DOMAIN } from './main';

export class CreateI2P {
  private readonly sizeNetwork: number = DEFAULT_NETWORK_SIZE;
  private readonly pathYml: string;
  private readonly baseIP: string;
  private readonly portP2P: number;

  constructor(sizeNetwork: number = DEFAULT_NETWORK_SIZE) {
    this.sizeNetwork =
      Math.floor(sizeNetwork) > 0 && Math.floor(sizeNetwork) <= MAX_NETWORK_SIZE
        ? Math.floor(sizeNetwork)
        : DEFAULT_NETWORK_SIZE;
    this.pathYml = path.join(__dirname, 'i2p-testnet.yml');

    this.baseIP = process.env.BASE_IP || DEFAULT_BASE_IP;
    this.portP2P =
      Number(process.env.PORT_P2P) > 1024 && Number(process.env.PORT_P2P) < 48000
        ? Number(process.env.PORT_P2P)
        : DEFAULT_PORT_P2P;

    this.createI2P();
  }

  private createI2P() {
    const i2p = this.getI2PYml();
    const yml =
      'version: "3.7"\nservices:\n' +
      i2p.c +
      'networks:\n' +
      `  network.${DEFAULT_BASE_DOMAIN}:\n` +
      `    name: network.${DEFAULT_BASE_DOMAIN}\n` +
      '    ipam:\n' +
      '      driver: default\n' +
      '      config:\n' +
      `        - subnet: ${this.baseIP}0/24\n\n` +
      'volumes:\n' +
      i2p.v;

    fs.writeFileSync(this.pathYml, yml);
  }

  private getI2PYml(): { c: string; v: string } {
    let container = '';
    let volumes = '';
    for (let seq = 1; seq <= this.sizeNetwork; seq++) {
      const nameI2P = `n${seq}.${DEFAULT_BASE_DOMAIN}`;
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
        `      network.${DEFAULT_BASE_DOMAIN}:\n` +
        `        ipv4_address: ${this.baseIP}${50 + seq}\n\n`;
      volumes = volumes + `  ${nameI2P}:\n    name: ${nameI2P}\n`;

      const pTunnel = path.join(__dirname, `tunnels.conf.d/${nameI2P}/`);
      fs.mkdirSync(pTunnel, { mode: '755', recursive: true });
      fs.writeFileSync(
        pTunnel + 'testnet.conf',
        `[${nameI2P}]\n` +
          'type = server\n' +
          `host = ${this.baseIP}${50 + seq}\n` +
          `port = ${this.portP2P}\n` +
          'gzip = false\n' +
          `keys = ${nameI2P}.dat\n`
      );
    }
    return { c: container, v: volumes };
  }
}
