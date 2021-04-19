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

import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import path from 'path';
import { CommandAddPeer, CommandRemovePeer } from './transaction';
import { BlockStruct } from './block';
import { Network, NetworkPeer } from '../net/network';
import { Config } from '../config';

export class State {
  private readonly config: Config;
  private readonly network: Network;
  private readonly publicKey: string;
  private readonly dbState: InstanceType<typeof LevelUp>;

  private height: number = 0;
  private mapPeer: Map<string, NetworkPeer> = new Map();

  constructor(config: Config, network: Network) {
    this.config = config;
    this.network = network;
    this.publicKey = this.network.getIdentity();
    this.dbState = LevelUp(LevelDown(path.join(this.config.path_state, this.publicKey)), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  async init() {
    try {
      this.mapPeer = JSON.parse(await this.dbState.get('peer'));
      this.height = await this.dbState.get('height');
    } catch (error) {
      this.mapPeer = this.mapPeer.size > 0 ? this.mapPeer : new Map();
      await this.dbState.put('peer', JSON.stringify(this.mapPeer));

      this.height = 0;
      await this.dbState.put('height', this.height);
    }
  }

  async process(block: BlockStruct) {
    if (this.height >= block.height) {
      return;
    }
    this.height = block.height;
    await this.dbState.put('height', this.height);

    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case 'testLoad':
            break;
          case 'addPeer':
            await this.addPeer(c as CommandAddPeer);
            break;
          case 'removePeer':
            await this.removePeer(c as CommandRemovePeer);
            break;
        }
      }
    }
  }

  getPeers(): Array<[string, NetworkPeer]> {
    return this.mapPeer.size > 0 ? [...this.mapPeer.entries()] : [];
  }

  private async addPeer(command: CommandAddPeer) {
    if (!this.mapPeer.has(command.publicKey)) {
      const peer: NetworkPeer = { host: command.host, port: command.port };
      this.mapPeer.set(command.publicKey, peer);
      await this.dbState.put('peer', JSON.stringify(this.mapPeer));
      this.network.addPeer(command.publicKey, peer);
    }
  }

  private async removePeer(command: CommandRemovePeer) {
    if (this.mapPeer.has(command.publicKey)) {
      this.mapPeer.delete(command.publicKey);
      await this.dbState.put('peer', JSON.stringify(this.mapPeer));
      this.network.removePeer(command.publicKey);
    }
  }
}
