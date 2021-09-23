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

import SocksProxyAgent from 'socks-proxy-agent/dist/agent';
import get from 'simple-get';
import { Logger } from '../logger';
import { Server } from './server';
import { nanoid } from 'nanoid';
import { Util } from '../chain/util';
import { CommandAddPeer } from '../chain/transaction';
import { BlockStruct } from '../chain/block';

const MAX_RETRY = 10;
const LENGTH_TOKEN = 32;

type Options = {
  url: string;
  agent: boolean | object;
  timeout: number;
  followRedirects: boolean;
};

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;
  private arrayNetwork: Array<{ publicKey: string; api: string }> = [];

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

    const i2p_socks_proxy_host = this.server.config.i2p_socks_proxy_host;
    const i2p_socks_proxy_console_port = this.server.config.i2p_socks_proxy_console_port;
    const port = this.server.config.port;

    const reI2P = new RegExp(`.b32.i2p:${port}$`, 'g');
    if (!i2p_socks_proxy_host || !i2p_socks_proxy_console_port || this.server.config.address.match(reI2P)) {
      return this;
    }

    const html = await this.fetch(`http://${i2p_socks_proxy_host}:${i2p_socks_proxy_console_port}/?page=i2p_tunnels`);
    const reB32 = new RegExp(`b32=[^>]*>([^<]+).+?([a-z0-9]+.b32.i2p:${port})`, 'g');
    const arrayB32 = [...html.matchAll(reB32)];
    if (arrayB32.length !== 1 || !arrayB32[0][2]) {
      throw new Error('Local I2P console not available: cannot read b32-address');
    }
    this.server.config.address = arrayB32[0][2];

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
    await this.fetchFromApi('join/' + this.server.config.address + '/' + publicKey);
  }

  join(address: string, publicKey: string): boolean {
    const ident = address + '/' + publicKey;

    //@TODO rather simple address check
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.]{2,128}[A-Za-z0-9]:[\d]{4,5}$/.test(address) ||
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
      this.mapToken.has(ident) ||
      this.server.getNetwork().hasNetworkAddress(address) ||
      this.server.getNetwork().hasNetworkPeer(publicKey)
    ) {
      return false;
    }

    const token = nanoid(LENGTH_TOKEN);
    this.mapToken.set(ident, token);

    setTimeout(async () => {
      let res: { token: string } = { token: '' };
      try {
        res = JSON.parse(await this.fetch('http://' + address + '/challenge/' + token));
        this.confirm(address, publicKey, res.token);
      } catch (error: any) {
        Logger.warn(error.toString());

        // retry
        this.mapToken.delete(ident);
        setTimeout(() => {
          this.join(address, publicKey);
        }, 30000);
      }
    }, 30000);

    return true;
  }

  challenge(token: string): string {
    return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
  }

  private confirm(address: string, publicKey: string, signedToken: string) {
    const ident = address + '/' + publicKey;
    const token = this.mapToken.get(ident) || '';

    if (!Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm() - Util.verifySignature() failed: ' + signedToken + ' / ' + token);
    }

    const [host, port] = address.split(':');

    if (
      !this.server.stackTxProposal([
        {
          seq: 1,
          command: 'addPeer',
          host: host,
          port: Number(port),
          publicKey: publicKey,
        } as CommandAddPeer,
      ])
    ) {
      throw new Error('Bootstrap.confirm() - stackTransaction()/addPeer failed');
    }
    this.server.releaseTxProposal();
    this.mapToken.delete(ident);
  }

  private async populateNetwork() {
    let r = 0;
    do {
      try {
        this.arrayNetwork = JSON.parse(await this.fetch(this.server.config.bootstrap + '/network'));
      } catch (error: any) {
        Logger.warn(error.toString());
        this.arrayNetwork = [];
      }
      r++;
    } while (!this.arrayNetwork.length && r < MAX_RETRY);

    if (!this.arrayNetwork.length) {
      throw new Error('Network not available');
    }
  }

  private async fetchFromApi(endpoint: string) {
    const aNetwork = Util.shuffleArray(this.arrayNetwork.filter((v) => v.api !== this.server.config.address));
    let urlApi = '';
    do {
      urlApi = 'http://' + aNetwork.pop().api + '/' + endpoint;
      try {
        return JSON.parse(await this.fetch(urlApi));
      } catch (error: any) {
        Logger.warn(error.toString());
      }
    } while (aNetwork.length);

    throw new Error('Fetch failed: ' + urlApi);
  }

  private fetch(url: string): Promise<string> {
    const config = this.server.config;

    const options: Options = {
      url: url,
      agent: false,
      timeout: 10000,
      followRedirects: false,
    };

    if (config.i2p_socks_proxy_host && config.i2p_socks_proxy_port && /^http:\/\/[a-z0-9.]+\.i2p/.test(options.url)) {
      options.agent = new SocksProxyAgent(`socks://${config.i2p_socks_proxy_host}:${config.i2p_socks_proxy_port}`);
    }

    return new Promise((resolve, reject) => {
      get.concat(options, (error: Error, res: any, data: Buffer) => {
        if (error || res.statusCode !== 200) {
          reject(error || { url: options.url, statusCode: res.statusCode });
        } else {
          resolve(data.toString());
        }
      });
    });
  }
}
