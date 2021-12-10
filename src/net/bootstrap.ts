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

import { Logger } from '../logger';
import { Server } from './server';
import { Util } from '../chain/util';
import { CommandAddPeer } from '../chain/transaction';
import { BlockStruct } from '../chain/block';
import { nanoid } from 'nanoid';

const MAX_RETRY = 10;
const LENGTH_TOKEN = 32;
const MIN_WAIT_JOIN_MS = 15000;
const MAX_WAIT_JOIN_MS = 60000;

type recordNetwork = { publicKey: string; http: string; udp: string };

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;
  private arrayNetwork: Array<recordNetwork> = [];

  static async make(server: Server): Promise<Bootstrap> {
    const b = new Bootstrap(server);
    return await b.init();
  }

  private constructor(server: Server) {
    this.server = server;
    this.mapToken = new Map();
  }

  private async init(): Promise<Bootstrap> {
    if (this.server.config.bootstrap) {
      Logger.info(`Bootstrapping network, using ${this.server.config.bootstrap}`);
      await this.populateNetwork();
    }

    return this;
  }

  async syncWithNetwork() {
    const blockNetwork: BlockStruct = await this.fetchFromApi('block/latest');
    const blockLocal: BlockStruct = this.server.getBlockchain().getLatestBlock();

    if (blockLocal.hash !== blockNetwork.hash) {
      const genesis: BlockStruct = await this.fetchFromApi('block/genesis');
      await this.server.getBlockchain().reset(genesis);
      let h = 1;
      while (blockNetwork.height > h) {
        const arrayBlocks: Array<BlockStruct> = await this.fetchFromApi('sync/' + (h + 1));
        for (const b of arrayBlocks) {
          this.server.getBlockchain().add(b);
        }
        h = this.server.getBlockchain().getLatestBlock().height;
      }
    }
  }
  async enterNetwork(publicKey: string) {
    await this.fetchFromApi('join/' + this.server.config.http + '/' + this.server.config.udp + '/' + publicKey);
  }

  join(http: string, udp: string, publicKey: string, t: number = MIN_WAIT_JOIN_MS): boolean {
    t = Math.floor(t);
    t = t < MIN_WAIT_JOIN_MS ? MIN_WAIT_JOIN_MS : t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t;

    if (
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
      this.mapToken.has(publicKey) ||
      this.server.getBlockchain().hasPeer(publicKey)
    ) {
      return false;
    }

    const token = nanoid(LENGTH_TOKEN);
    this.mapToken.set(publicKey, token);

    setTimeout(async () => {
      let res: { token: string } = { token: '' };
      try {
        res = JSON.parse(await this.fetch('http://' + http + '/challenge/' + token));
        this.confirm(http, udp, publicKey, res.token);
      } catch (error) {
        Logger.warn('Bootstrap.join() failed: ' + JSON.stringify(error));

        // retry
        this.mapToken.delete(publicKey);
        t = t + MIN_WAIT_JOIN_MS;
        setTimeout(() => {
          this.join(http, udp, publicKey, t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t);
        }, t);
      }
    }, t);

    return true;
  }

  //@FIXME only accessible, if the server is in "challenging" state
  challenge(token: string): string {
    return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
  }

  private confirm(http: string, udp: string, publicKey: string, signedToken: string) {
    const token = this.mapToken.get(publicKey) || '';

    if (!Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm() - Util.verifySignature() failed: ' + signedToken + ' / ' + token);
    }

    if (
      !this.server.stackTx([
        {
          seq: 1,
          command: 'addPeer',
          http: http,
          udp: udp,
          publicKey: publicKey,
        } as CommandAddPeer,
      ])
    ) {
      throw new Error('Bootstrap.confirm() - stackTransaction(addPeer) failed');
    }
    this.mapToken.delete(publicKey);
  }

  private async populateNetwork() {
    let r = 0;
    do {
      try {
        this.arrayNetwork = JSON.parse(await this.fetch(this.server.config.bootstrap + '/network')).sort(
          (a: recordNetwork, b: recordNetwork) => {
            return a.publicKey > b.publicKey ? 1 : -1;
          }
        );
      } catch (error) {
        Logger.warn('Bootstrap.populateNetwork() failed: ' + JSON.stringify(error));
        this.arrayNetwork = [];
      }
      r++;
    } while (!this.arrayNetwork.length && r < MAX_RETRY);

    if (!this.arrayNetwork.length) {
      throw new Error('Network not available');
    }
  }

  private async fetchFromApi(endpoint: string) {
    const aNetwork = Util.shuffleArray(this.arrayNetwork.filter((v) => v.http !== this.server.config.http));
    let urlApi = '';
    do {
      urlApi = 'http://' + aNetwork.pop().api + '/' + endpoint;
      try {
        return JSON.parse(await this.fetch(urlApi));
      } catch (error) {
        Logger.warn('Bootstrap.fetchFromApi() failed: ' + JSON.stringify(error));
      }
    } while (aNetwork.length);

    throw new Error('Fetch failed: ' + urlApi);
  }

  private fetch(url: string): Promise<string> {
    //@FIXME via SAM to an HTTP endpoint...
    return Promise.resolve('NOT IMPLEMENTED');
  }
}
