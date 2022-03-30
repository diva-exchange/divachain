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
import { Message } from './message/message';
import { Server } from './server';
import EventEmitter from 'events';
import {
  createDatagram,
  I2pSamDatagram,
  createForward,
  I2pSamStream,
  toB32,
} from '@diva.exchange/i2p-sam/dist/i2p-sam';
import { Util } from '../chain/util';
import crypto from 'crypto';
import get from 'simple-get';
import SocksProxyAgent from 'socks-proxy-agent/dist/agent';
import { Peer } from '../chain/blockchain';

type Options = {
  url: string;
  agent: SocksProxyAgent | false;
  timeout: number;
  followRedirects: boolean;
};

export class Network extends EventEmitter {
  private readonly server: Server;
  private readonly socksProxyAgent: SocksProxyAgent | false;
  private readonly publicKey: string;

  private samForward: I2pSamStream = {} as I2pSamStream;
  private samUDP: I2pSamDatagram = {} as I2pSamDatagram;

  private arrayNetwork: Array<Peer> = [];
  private arrayBroadcast: Array<string> = [];

  private arrayBroadcasted: Array<string> = [];
  private arrayProcessed: Array<string> = [];

  private readonly _onMessage: Function | false;

  private timeoutP2P: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutClean: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server, onMessage: Function) {
    return new Network(server, onMessage);
  }

  private constructor(server: Server, onMessage: Function) {
    super();

    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();
    Logger.info(`Network, public key: ${this.publicKey}`);

    this.socksProxyAgent = new SocksProxyAgent(
      `socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`
    );
    Logger.info(
      `Network, using SOCKS: socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`
    );

    if (this.server.config.bootstrap) {
      this.bootstrapNetwork();
    }
    this.init();

    this._onMessage = onMessage || false;

    this.timeoutClean = setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  shutdown() {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutClean);
  }

  private init() {
    Logger.info(`P2P starting on ${toB32(this.server.config.udp)}.b32.i2p`);

    let retry = 0;
    let started = false;
    const i = setInterval(() => {
      retry++;
      if (retry > 60) {
        throw new Error(`P2P failed on ${toB32(this.server.config.udp)}.b32.i2p`);
      }

      if (started) {
        if (this.hasP2PNetwork()) {
          this.emit('ready');
          clearInterval(i);
          Logger.info(`P2P ready on ${toB32(this.server.config.udp)}.b32.i2p`);
        }
        return;
      }

      started = true;
      this.p2pNetwork();

      (async () => {
        const _c = this.server.config;
        this.samForward = (
          await createForward({
            sam: {
              host: _c.i2p_sam_http_host,
              portTCP: _c.i2p_sam_http_port_tcp,
              publicKey: _c.i2p_public_key_http,
              privateKey: _c.i2p_private_key_http,
            },
            forward: {
              host: _c.i2p_sam_forward_http_host,
              port: _c.i2p_sam_forward_http_port,
              silent: true,
            },
          })
        ).on('error', (error: any) => {
          Logger.warn('SAM HTTP ' + error.toString());
        });
        Logger.info(
          `HTTP ${toB32(_c.http)}.b32.i2p to ${_c.i2p_sam_forward_http_host}:${_c.i2p_sam_forward_http_port}`
        );
      })();

      (async () => {
        const _c = this.server.config;
        this.samUDP = (
          await createDatagram({
            sam: {
              host: _c.i2p_sam_udp_host,
              portTCP: _c.i2p_sam_udp_port_tcp,
              publicKey: _c.i2p_public_key_udp,
              privateKey: _c.i2p_private_key_udp,
            },
            listen: {
              address: _c.i2p_sam_listen_udp_host,
              port: _c.i2p_sam_listen_udp_port,
              hostForward: _c.i2p_sam_forward_udp_host,
              portForward: _c.i2p_sam_forward_udp_port,
            },
          })
        )
          .on('data', (data: Buffer, from: string) => {
            this.incomingData(data, from);
          })
          .on('error', (error: any) => {
            Logger.warn('SAM UDP ' + error.toString());
          });
        Logger.info(`UDP ${toB32(_c.udp)}.b32.i2p to ${_c.i2p_sam_forward_udp_host}:${_c.i2p_sam_forward_udp_port}`);
      })();
    }, 1000);
  }

  private hasP2PNetwork() {
    return (
      (this.server.config.bootstrap ||
        this.arrayNetwork.length > [...this.server.getBlockchain().getMapPeer().values()].length * 0.5) &&
      Object.keys(this.samForward).length &&
      Object.keys(this.samUDP).length
    );
  }

  private incomingData(data: Buffer, from: string) {
    const msg = data.toString().trim();
    if (!msg || !from) {
      return;
    }

    if (/^[\d]+$/.test(msg)) {
      // incoming ping, including height
      if (Number(msg) > this.server.getBlockchain().getHeight()) {
        this.server.sync();
      }
    } else {
      try {
        this.processMessage(new Message(msg));
      } catch (error: any) {
        Logger.warn(`Network.incomingData() ${error.toString()}`);
      }
    }
  }

  private p2pNetwork() {
    this.timeoutP2P = setTimeout(() => {
      this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);

    const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
    if (!aNetwork.length || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
      return;
    }

    this.arrayNetwork = aNetwork;

    this.arrayBroadcast = Util.shuffleArray(
      [...this.server.getBlockchain().getMapPeer().keys()].filter((pk) => {
        return pk !== this.publicKey;
      })
    );

    // pinging: rectangular distribution of pings over time
    const step = Math.floor(this.server.config.network_p2p_interval_ms / (this.arrayBroadcast.length + 2));
    let int = crypto.randomInt(step) + 1;
    const buf = Buffer.from(this.server.getBlockchain().getHeight() + '\n');
    this.arrayBroadcast.forEach((pk) => {
      setTimeout(() => {
        this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
      }, int);
      int = int + step;
    });
  }

  private processMessage(m: Message) {
    // stateless validation
    if (!this.server.getValidation().validateMessage(m)) {
      return;
    }

    if (this.arrayProcessed.includes(m.ident())) {
      return;
    }
    this.arrayProcessed.push(m.ident());

    // process message
    this._onMessage && this._onMessage(m);
  }

  private clean() {
    this.arrayBroadcasted.splice(0, Math.floor(this.arrayBroadcasted.length / 3));
    this.arrayProcessed.splice(0, Math.floor(this.arrayProcessed.length / 3));

    this.timeoutClean = setTimeout(() => {
      this.clean();
    }, this.server.config.network_clean_interval_ms);
  }

  getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  broadcast(m: Message) {
    const ident: string = m.ident();
    const buf: Buffer = Buffer.from(m.pack());
    this.arrayBroadcast
      .filter((pk) => {
        return !this.arrayBroadcasted.includes(pk + ident) && pk !== m.origin();
      })
      .forEach((pk) => {
        try {
          this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
          this.arrayBroadcasted.push(pk + ident);
        } catch (error: any) {
          Logger.warn(`Network.broadcast() ${error.toString()}`);
        }
      });
  }

  async fetchFromApi(endpoint: string) {
    if (endpoint.indexOf('http://') === 0) {
      return await this.fetch(endpoint);
    }

    if (!this.arrayNetwork.length) {
      throw new Error('Network unavailable');
    }

    const aNetwork = Util.shuffleArray(this.arrayNetwork.filter((v) => v.http !== this.server.config.http));
    let urlApi = '';
    do {
      urlApi = `http://${toB32(aNetwork.pop().http)}.b32.i2p/${endpoint}`;
      try {
        return JSON.parse(await this.fetch(urlApi));
      } catch (error: any) {
        Logger.warn('Network.fetchFromApi() ' + error.toString());
      }
    } while (aNetwork.length);

    throw new Error('Fetch failed: ' + urlApi);
  }

  private fetch(url: string): Promise<string> {
    const options: Options = {
      url: url,
      agent: this.socksProxyAgent,
      timeout: 10000,
      followRedirects: false,
    };

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

  private bootstrapNetwork() {
    Logger.info('Bootstrapping, using: ' + this.server.config.bootstrap + '/network');

    const _i = setInterval(async () => {
      try {
        this.arrayNetwork = JSON.parse(
          await this.server.getNetwork().fetchFromApi(this.server.config.bootstrap + '/network')
        );
      } catch (error: any) {
        Logger.warn('Network.populateNetwork() ' + error.toString());
        this.arrayNetwork = [];
      }
      if (this.arrayNetwork.length) {
        clearInterval(_i);
      }
    }, 10000);
  }
}
