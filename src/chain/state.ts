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
import { CommandAddPeer, CommandRemovePeer } from './transaction';
import { BlockStruct } from './block';
import { Network, NetworkPeer } from '../net/network';
import { Config } from '../config';
import * as fs from 'fs';

export class State {
  private readonly config: Config;
  private readonly network: Network;
  private readonly publicKey: string;
  private readonly pathState: string;

  private height: number = 0;
  private mapPeer: Map<string, NetworkPeer> = new Map();

  constructor(config: Config, network: Network) {
    this.config = config;
    this.network = network;
    this.publicKey = this.network.getIdentity();
    this.pathState = path.join(this.config.path_state, this.publicKey);
    if (!fs.existsSync(this.pathState)) {
      fs.mkdirSync(this.pathState, { mode: '755', recursive: true });
    }
  }

  init() {
    try {
      this.mapPeer = new Map(this.read('peer'));
      this.height = this.read('height');
    } catch (error) {
      this.mapPeer = this.mapPeer.size > 0 ? this.mapPeer : new Map();
      this.write('peer', this.mapPeer);

      this.height = 0;
      this.write('height', this.height);
    }

    this.mapPeer.forEach((peer, publicKey) => {
      this.network.addPeer(publicKey, peer);
    });
  }

  process(block: BlockStruct) {
    if (this.height >= block.height) {
      return;
    }
    this.height = block.height;
    this.write('height', this.height);

    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case 'testLoad':
            break;
          case 'addPeer':
            this.addPeer(c as CommandAddPeer);
            break;
          case 'removePeer':
            this.removePeer(c as CommandRemovePeer);
            break;
        }
      }
    }
  }

  getPeers(): Array<[string, NetworkPeer]> {
    return this.mapPeer.size > 0 ? [...this.mapPeer.entries()] : [];
  }

  getHeight(): number {
    return this.height;
  }

  private addPeer(command: CommandAddPeer) {
    if (!this.mapPeer.has(command.publicKey)) {
      const peer: NetworkPeer = { host: command.host, port: command.port };
      this.mapPeer.set(command.publicKey, peer);
      this.write('peer', this.mapPeer);
      this.network.addPeer(command.publicKey, peer);
    }
  }

  private removePeer(command: CommandRemovePeer) {
    if (this.mapPeer.has(command.publicKey)) {
      this.mapPeer.delete(command.publicKey);
      this.write('peer', this.mapPeer);
      this.network.removePeer(command.publicKey);
    }
  }

  private read(key: string): any {
    const _p = path.join(this.pathState, key);
    return fs.existsSync(_p) ? JSON.parse(fs.readFileSync(_p).toString()) : null;
  }

  private write(key: string, value: any) {
    fs.writeFileSync(path.join(this.pathState, key), JSON.stringify(value));
  }
}
