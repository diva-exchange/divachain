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

const MAX_RETRY = 10;

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

    this.socksProxyAgent = this.server.config.has_i2p
      ? new SocksProxyAgent(`socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`)
      : false;
    this.socksProxyAgent &&
      Logger.info(
        `Network, using SOCKS: socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`
      );

    this.init();

    this._onMessage = onMessage || false;

    this.timeoutClean = setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  shutdown() {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutClean);

    this.samUDP.close();
  }

  private init() {
    let started = false;
    const i = setInterval(() => {
      const _c = this.server.config;

      if (!started) {
        this.populateNetwork();

        if (this.arrayNetwork.length > 0) {
          started = true;
          Logger.info(`P2P starting on ${toB32(_c.udp)}.b32.i2p`);

          (async () => {
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
              Logger.warn('SAM HTTP Error: ' + error.toString());
            });
            Logger.info(
              `HTTP ${toB32(_c.http)}.b32.i2p to ${_c.i2p_sam_forward_http_host}:${_c.i2p_sam_forward_http_port}`
            );
          })();

          (async () => {
            this.samUDP = (
              await createDatagram({
                sam: {
                  host: _c.i2p_sam_udp_host,
                  portTCP: _c.i2p_sam_udp_port_tcp,
                  publicKey: _c.i2p_public_key_udp,
                  privateKey: _c.i2p_private_key_udp,
                },
                listen: {
                  address: '0.0.0.0',
                  port: _c.i2p_sam_forward_udp_port,
                  hostForward: _c.i2p_sam_forward_udp_host,
                  portForward: _c.i2p_sam_forward_udp_port,
                },
              })
            )
              .on('data', (data: Buffer, from: string) => {
                this.incomingData(data, from);
              })
              .on('error', (error: any) => {
                Logger.warn('SAM UDP Error: ' + error.toString());
              });

            this.p2pNetwork();
          })();
        }
      } else {
        const nq =
          this.server.getBlockchain().getStake(this.publicKey) +
          this.arrayBroadcast.reduce((q, pk) => q + this.server.getBlockchain().getStake(pk), 0);
        if (nq >= this.server.getBlockchain().getQuorum()) {
          Logger.info(`UDP ${toB32(_c.udp)}.b32.i2p to ${_c.i2p_sam_forward_udp_host}:${_c.i2p_sam_forward_udp_port}`);
          this.emit('ready');
          clearInterval(i);
        }
      }
    }, 2000);
  }

  private incomingData(data: Buffer, from: string) {
    const msg = data.toString().trim();
    if (!msg || !from) {
      return;
    }

    if (/^[\d]+$/.test(msg)) {
      // incoming ping, including height
      if (Number(msg) > this.server.getBlockchain().getHeight()) {
        //@FIXME logging
        Logger.trace(`Ping triggers sync FROM ${toB32(from)}.b32.i2p`);
        this.server.sync();
      }
    } else {
      try {
        this.processMessage(new Message(msg));
      } catch (error: any) {
        Logger.warn(`Network.incomingData(): ${error.toString()}`);
      }
    }
  }

  private p2pNetwork() {
    this.timeoutP2P = setTimeout(async () => {
      this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);

    this.arrayBroadcast = Util.shuffleArray(
      this.arrayNetwork
        .map((p) => p.publicKey)
        .filter((pk) => {
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
        this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
        this.arrayBroadcasted.push(pk + ident);
      });
  }

  async fetchFromApi(endpoint: string) {
    if (endpoint.indexOf('http://') === 0) {
      return await this.fetch(endpoint);
    }

    const aNetwork = Util.shuffleArray(this.arrayNetwork.filter((v) => v.http !== this.server.config.http));
    let urlApi = '';
    do {
      urlApi = 'http://' + toB32(aNetwork.pop().http) + '.b32.i2p/' + endpoint;
      try {
        return JSON.parse(await this.fetch(urlApi));
      } catch (error: any) {
        Logger.warn('Network.fetchFromApi() failed: ' + error.toString());
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

  private populateNetwork() {
    if (!this.server.config.bootstrap) {
      this.arrayNetwork = [...this.server.getBlockchain().getMapPeer().values()];
      return;
    }

    (async () => {
      let r = 0;
      do {
        try {
          this.arrayNetwork = JSON.parse(
            await this.server.getNetwork().fetchFromApi(this.server.config.bootstrap + '/network')
          ).sort((a: Peer, b: Peer) => {
            return a.publicKey > b.publicKey ? 1 : -1;
          });
        } catch (error: any) {
          Logger.warn('Network.populateNetwork() failed: ' + error.toString());
          this.arrayNetwork = [];
        }
        r++;
      } while (!this.arrayNetwork.length && r < MAX_RETRY);

      if (!this.arrayNetwork.length) {
        throw new Error('Network not available');
      }
    })();
  }
}
