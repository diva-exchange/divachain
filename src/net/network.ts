/**
 * Copyright (C) 2021-2022 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
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
import get from 'simple-get';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Peer } from '../chain/blockchain';
import { Sync } from './message/sync';
import { BlockStruct } from '../chain/block';

type Options = {
  url: string;
  agent: SocksProxyAgent | false;
  timeout: number;
  followRedirects: boolean;
};

export class Network extends EventEmitter {
  private readonly server: Server;
  private readonly publicKey: string;
  private readonly agent: SocksProxyAgent;

  private samForward: I2pSamStream = {} as I2pSamStream;
  private samUDP: I2pSamDatagram = {} as I2pSamDatagram;

  private arrayNetwork: Array<Peer> = [];
  private arrayBroadcast: Array<string> = [];

  private arrayLatency: Array<number> = [];

  private mapPingSeq: Map<string, number> = new Map();
  private mapMsgSeq: Map<string, number> = new Map();
  private mapAvailability: Map<string, Array<{ t: number; a: boolean }>> = new Map();

  private readonly _onMessage: Function;
  private isClosing: boolean = false;

  private timeoutP2P: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server, onMessage: Function) {
    return new Network(server, onMessage);
  }

  private constructor(server: Server, onMessage: Function) {
    super();

    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();
    Logger.info(`Network, public key: ${this.publicKey}`);

    this.agent = new SocksProxyAgent(
      `socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`,
      { timeout: this.server.config.network_timeout_ms }
    );

    Logger.info(
      `Network, using SOCKS: socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`
    );

    if (this.server.config.bootstrap) {
      this.bootstrapNetwork();
    }

    Logger.info(`P2P starting on ${toB32(this.server.config.udp)}.b32.i2p`);
    this.init();

    this._onMessage = onMessage;
  }

  shutdown() {
    this.isClosing = true;
    typeof this.agent.destroy === 'function' && this.agent.destroy();
    typeof this.samForward.close === 'function' && this.samForward.close();
    typeof this.samUDP.close === 'function' && this.samUDP.close();
    clearTimeout(this.timeoutP2P);
  }

  private init(started: boolean = false, retry: number = 0) {
    retry++;
    if (retry > 60) {
      throw new Error(`P2P failed on ${toB32(this.server.config.udp)}.b32.i2p`);
    }

    if (this.hasP2PNetwork()) {
      this.emit('ready');
      Logger.info(`P2P ready on ${toB32(this.server.config.udp)}.b32.i2p`);
    } else {
      setTimeout(() => {
        this.init(true, retry);
      }, 2000);
    }

    if (started) {
      return;
    }

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
      Logger.info(`HTTP ${toB32(_c.http)}.b32.i2p to ${_c.i2p_sam_forward_http_host}:${_c.i2p_sam_forward_http_port}`);

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

    this.p2pNetwork();
  }

  private hasP2PNetwork(): Boolean {
    return (
      this.arrayNetwork.length > [...this.server.getBlockchain().getMapPeer().values()].length * 0.5 &&
      Object.keys(this.samForward).length > 0 &&
      Object.keys(this.samUDP).length > 0
    );
  }

  private incomingData(data: Buffer, from: string) {
    if (this.isClosing || !this.arrayNetwork.length) {
      return;
    }

    const msg = data.toString().trim();
    const pk = this.server.getBlockchain().getPublicKeyByUdp(from);
    if (!msg || !pk) {
      return;
    }

    if (/^[\d]{1,32}![\d]+$/.test(msg)) {
      this.incomingPing(msg, pk);
    } else {
      this.incomingMessage(msg);
    }
  }

  private incomingPing(msg: string, fromPublicKey: string) {
    const [_d, _h] = msg.split('!');
    const dt: number = Number(_d);

    // flood & old ping protection
    const _n: number = Date.now();
    const _s: number = this.mapPingSeq.get(fromPublicKey) || 0;
    const _f = this.server.config.network_p2p_interval_ms * (Math.floor(this.arrayBroadcast.length / 3) + 1);
    if (dt < _n - (_f ^ 3) || dt > _n + (_f ^ 2) || _s > _n - _f || _s >= dt) {
      return;
    }
    this.mapPingSeq.set(fromPublicKey, dt);

    const h: number = Number(_h);
    // send sync packets?
    for (let sh = h; sh < this.server.getBlockchain().getHeight(); sh++) {
      (async (_h: number, toPublicKey: string) => {
        const b: BlockStruct = (await this.server.getBlockchain().getRange(_h))[0];
        const buf: Buffer = Buffer.from(new Sync().create(this.server.getWallet(), b).pack());
        this.samUDP.send(this.server.getBlockchain().getPeer(toPublicKey).udp, buf);
      })(sh + 1, fromPublicKey);
      if (sh - h > this.server.config.network_sync_size) {
        break;
      }
    }

    //@TODO just some stats...
    // average network latency
    const diff = Date.now() - dt;
    diff > 0 && diff < 60000 && this.arrayLatency.unshift(diff);
    if (this.arrayLatency.length > this.arrayBroadcast.length * 3) {
      const avgLatency = Math.ceil(this.arrayLatency.reduce((p, l) => p + l, 0) / this.arrayLatency.length);
      this.arrayLatency = this.arrayLatency.slice(0, this.arrayBroadcast.length * 2);
      //@FIXME logging
      // Logger.trace(`${this.server.config.port}: height ${fromPublicKey}: ${h} --- avgLatency ${avgLatency}`);
    }

    // PoS influence: availability
    // statistical dispersion of pings of a peer. Desired behaviour?
  }

  private incomingMessage(msg: string) {
    try {
      const m: Message = new Message(msg);
      // stateless validation
      if (!this.server.getValidation().validateMessage(m)) {
        return;
      }

      //@TODO this is not strictly true for sync messages, it might even hinder synchronization
      // messages with an older sequence must be ignored
      if ((this.mapMsgSeq.get([m.type(), m.origin()].join()) || 0) >= m.seq()) {
        return;
      }
      this.mapMsgSeq.set([m.type(), m.origin()].join(), m.seq());

      // process message
      this._onMessage(m);

      //gossipping
      this.broadcast(m);
    } catch (error: any) {
      Logger.warn(`Network.incomingData() ${error.toString()}`);
    }
  }

  // update network, randomize broadcast peers and ping 1/3rd of the network peers
  private p2pNetwork() {
    const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
    const tTimeout = this.server.config.network_p2p_interval_ms * (Math.floor(aNetwork.length / 3) + 1);
    this.timeoutP2P = setTimeout(() => {
      this.p2pNetwork();
    }, tTimeout);

    if (aNetwork.length < 2 || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
      return;
    }
    this.arrayNetwork = aNetwork;

    this.arrayBroadcast = Util.shuffleArray(
      [...this.server.getBlockchain().getMapPeer().keys()].filter((pk) => {
        return pk !== this.publicKey;
      })
    );

    // ping: rectangular distribution of number of pings to network peers over time
    // measured over several hours, all online network peers receive more or less the same amount of pings
    setTimeout(() => {
      const buf = Buffer.from(Date.now() + '!' + this.server.getBlockchain().getHeight());
      this.arrayBroadcast.slice(0, Math.ceil(this.arrayBroadcast.length / 3)).forEach((pk) => {
        this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
      });
    }, Math.ceil(Math.random() * tTimeout));
  }

  getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  broadcast(m: Message) {
    const buf: Buffer = Buffer.from(m.pack());
    let a = this.arrayBroadcast.filter((pk) => m.origin() !== pk);
    a = m.origin() === this.publicKey ? a : a.slice(0, 2); // gossipping
    a.forEach((pk) => {
      try {
        this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
      } catch (error: any) {
        Logger.warn(`Network.broadcast() ${error.toString()}`);
      }
    });
  }

  async fetchFromApi(endpoint: string, timeout: number = 0): Promise<any> {
    if (endpoint.indexOf('http://') === 0) {
      try {
        const json = await this.fetch(endpoint);
        return JSON.parse(json);
      } catch (error: any) {
        Logger.warn(`Network.fetchFromApi() ${endpoint} - ${error.toString()}`);
      }
    } else if (this.arrayNetwork.length) {
      const aNetwork = Util.shuffleArray(this.arrayNetwork.filter((v) => v.http !== this.server.config.http));
      let urlApi = '';
      let n = aNetwork.pop();
      while (n) {
        urlApi = `http://${toB32(n.http)}.b32.i2p/${endpoint}`;
        try {
          return JSON.parse(await this.fetch(urlApi, timeout));
        } catch (error: any) {
          Logger.warn(`Network.fetchFromApi() ${urlApi} - ${error.toString()}`);
        }
        n = aNetwork.pop();
      }
    } else {
      Logger.warn('Network unavailable');
    }

    throw new Error('fetchFromApi failed');
  }

  private fetch(url: string, timeout: number = 0): Promise<string> {
    const options: Options = {
      url: url,
      agent: this.agent,
      timeout: timeout > 0 ? timeout : this.server.config.network_timeout_ms,
      followRedirects: false,
    };

    return new Promise((resolve, reject) => {
      get.concat(options, (error: Error, res: any, data: Buffer) => {
        if (error || res.statusCode !== 200) {
          reject(error || new Error(`${res.statusCode}, ${options.url}`));
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
        this.arrayNetwork = JSON.parse(await this.fetch(this.server.config.bootstrap + '/network'));
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
