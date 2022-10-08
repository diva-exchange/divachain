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
import {
  STAKE_PING_AMOUNT,
  STAKE_PING_IDENT,
  STAKE_PING_QUARTILE_COEFF_MAX,
  STAKE_PING_QUARTILE_COEFF_MIN,
  STAKE_PING_SAMPLE_SIZE,
} from '../config';

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
  private arrayOnline: Array<string> = [];
  private identCacheOnline: string = '';

  private mapPingSeq: Map<string, number> = new Map();
  private mapMsgSeq: Map<string, number> = new Map();
  private mapAvailability: Map<string, Array<number>> = new Map();

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
        Logger.warn(`${this.publicKey}: SAM HTTP ${error.toString()}`);
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
          Logger.warn(`${this.publicKey}: SAM UDP ${error.toString()}`);
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
      this.incomingPing(pk, msg);
    } else {
      this.incomingMessage(pk, msg);
    }
  }

  private incomingPing(fromPublicKey: string, msg: string) {
    if (fromPublicKey === this.publicKey) {
      return;
    }

    const [_d, _h] = msg.split('!');
    // unix timestamp contained within the ping message, not to be trusted
    const dt: number = Number(_d);

    // protection from flooding and outdated pings
    const _n: number = Date.now();
    const _s: number = this.mapPingSeq.get(fromPublicKey) || 0;
    const _f = this.server.config.network_p2p_interval_ms * (Math.floor(this.arrayBroadcast.length / 3) + 1);
    if (_s > _n - _f || _s >= dt) {
      return;
    }
    this.mapPingSeq.set(fromPublicKey, dt);

    // send sync packets
    const h: number = Number(_h);
    const diff = this.server.getBlockchain().getHeight() - h;
    if (diff > 0) {
      const _i = this.arrayOnline.indexOf(fromPublicKey);
      if (_i > -1) {
        this.arrayOnline.splice(_i, 1);
      }

      //@FIXME logging
      Logger.trace(`${this.server.config.port} / ${this.publicKey}: Send SYNC to ${fromPublicKey} - Diff: ${diff}`);
      for (let hsync = h + 1; hsync <= this.server.getBlockchain().getHeight(); hsync++) {
        (async (_h: number, toPublicKey: string) => {
          const b: BlockStruct = (await this.server.getBlockchain().getRange(_h))[0];
          const buf: Buffer = Buffer.from(new Sync().create(this.server.getWallet(), b).pack());
          this.samUDP.send(this.server.getBlockchain().getPeer(toPublicKey).udp, buf);
        })(hsync, fromPublicKey);
        if (hsync - h > this.server.config.network_sync_size) {
          break;
        }
      }
      return;
    }

    // set online peers
    this.arrayOnline = [this.publicKey];
    this.mapPingSeq.forEach((_dt, _pk) => {
      if (_dt > _n - this.server.config.network_p2p_interval_ms * this.arrayBroadcast.length * 1.5) {
        this.arrayOnline.push(_pk);
      }
    });
    const _c = this.arrayOnline.sort().join();
    if (_c !== this.identCacheOnline) {
      this.server.getBlockFactory().calcValidator();
      this.identCacheOnline = _c;
    }

    // PoS influence: availability
    // statistical dispersion of pings of a peer. Desired behaviour?
    // holding a local map of the availability of other peers and create a vote
    let a: Array<number> = this.mapAvailability.get(fromPublicKey) || [];
    a.push(dt);

    // compare mapAvailability with a wanted behaviour (=dispersion of values)
    if (a.length === STAKE_PING_SAMPLE_SIZE) {
      // calculate quartile coefficient
      const qc = Util.QuartileCoeff(a);
      if (qc >= STAKE_PING_QUARTILE_COEFF_MIN && qc <= STAKE_PING_QUARTILE_COEFF_MAX) {
        // place a vote for stake increase
        this.server.proposeModifyStake(fromPublicKey, STAKE_PING_IDENT, STAKE_PING_AMOUNT);
      }

      // remove 2/3rd of the data
      a = a.slice(-1 * Math.floor((a.length / 3) * 2));
    }

    this.mapAvailability.set(fromPublicKey, a);
  }

  private incomingMessage(fromPublicKey: string, msg: string) {
    const m: Message = new Message(msg);
    // stateless validation
    if (!this.server.getValidation().validateMessage(m)) {
      return;
    }

    // messages with an older sequence must be ignored
    if ((this.mapMsgSeq.get([m.type(), m.origin()].join()) || 0) >= m.seq()) {
      return;
    }
    this.mapMsgSeq.set([m.type(), m.origin()].join(), m.seq());

    // process message
    this._onMessage(m);

    //gossipping, only once
    fromPublicKey === m.origin() && this.broadcast(m, fromPublicKey);
  }

  // update network, randomize broadcast peers and ping 1/3rd of the network peers
  private p2pNetwork() {
    const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
    const tTimeout = this.server.config.network_p2p_interval_ms;
    this.timeoutP2P = setTimeout(() => {
      this.p2pNetwork();
    }, tTimeout);

    if (aNetwork.length < 2 || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
      return;
    }

    this.arrayNetwork = aNetwork;
    this.arrayBroadcast = Util.shuffleArray(
      [...this.server.getBlockchain().getMapPeer().keys()].filter((pk: string) => pk !== this.publicKey)
    );

    // ping: rectangular distribution of number of pings to network peers over time
    // measured over several hours, all online network peers receive more or less the same amount of pings
    setTimeout(() => {
      const buf = Buffer.from(Date.now() + '!' + this.server.getBlockchain().getHeight());
      this.arrayBroadcast.slice(0, Math.ceil(this.arrayBroadcast.length / 3)).forEach((pk) => {
        this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
      });
    }, Math.floor(Math.random() * tTimeout * 0.99));
  }

  getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  getArrayOnline(): Array<string> {
    return this.arrayOnline;
  }

  broadcast(m: Message, fromPublicKey: string = '') {
    const buf: Buffer = Buffer.from(m.pack());
    if (fromPublicKey !== '' && m.dest() !== '') {
      // gossipping with a destination
      try {
        this.samUDP.send(this.server.getBlockchain().getPeer(m.dest()).udp, buf);
      } catch (error: any) {
        Logger.warn(`Network.broadcast() ${error.toString()}`);
      }
    } else {
      // broadcasting
      const o: string = m.origin();
      this.arrayBroadcast
        .filter((pk) => o !== pk && fromPublicKey !== pk)
        .forEach((pk) => {
          try {
            this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
          } catch (error: any) {
            Logger.warn(`Network.broadcast() ${error.toString()}`);
          }
        });
    }
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
