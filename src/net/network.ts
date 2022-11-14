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
import { Status, ONLINE } from './message/status';

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

  private mapMsgSeq: Map<string, number> = new Map();
  private mapOnline: Map<string, number> = new Map();

  private readonly _onMessage: Function;
  private isClosing: boolean = false;

  private timeoutP2P: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutStatus: NodeJS.Timeout = {} as NodeJS.Timeout;

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
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutStatus);

    this.isClosing = true;
    typeof this.agent.destroy === 'function' && this.agent.destroy();
    typeof this.samForward.close === 'function' && this.samForward.close();
    this.samForward = {} as I2pSamStream;
    typeof this.samUDP.close === 'function' && this.samUDP.close();
    this.samUDP = {} as I2pSamDatagram;
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

    const pk = this.server.getBlockchain().getPublicKeyByUdp(from);
    const m: Message = new Message(data);
    // stateless validation
    if (!pk || !this.server.getValidation().validateMessage(m)) {
      return;
    }

    // messages with an older sequence must be ignored
    const keySeq: string = [m.type(), m.origin()].join();
    if ((this.mapMsgSeq.get(keySeq) || 0) < m.seq()) {
      this.mapMsgSeq.set(keySeq, m.seq());
      this.mapOnline.set(pk, Date.now());

      // process message
      this._onMessage(m);

      //gossipping, once
      m.type() !== Message.TYPE_STATUS && pk === m.origin() && this.broadcast(m, true);
    }
  }

  // update network, randomize broadcast peers and ping 1/3rd of the network peers
  private p2pNetwork() {
    const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
    this.timeoutP2P = setTimeout(() => {
      this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);
    this.mapOnline.set(this.publicKey, Date.now());

    if (aNetwork.length < 2 || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
      return;
    }

    this.arrayNetwork = aNetwork;
    this.arrayBroadcast = [...this.server.getBlockchain().getMapPeer().keys()].filter(
      (pk: string) => pk !== this.publicKey
    );

    // status message
    this.timeoutStatus = setTimeout(() => {
      this.broadcast(new Status().create(this.server.getWallet(), ONLINE, this.server.getBlockchain().getHeight()));
    }, Math.floor(Math.random() * this.server.config.network_p2p_interval_ms * 0.9));
  }

  cleanMapOnline() {
    const now: number = Date.now();
    this.mapOnline.forEach((_dt, _pk) => {
      if (_dt < now - this.server.config.block_retry_timeout_ms * this.arrayNetwork.length) {
        this.mapOnline.delete(_pk);
      }
    });
  }

  getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  getArrayOnline(): Array<string> {
    return [...this.mapOnline.keys()];
  }

  broadcast(m: Message, isFinalHop: boolean = false) {
    const msg: Buffer = m.asBuffer();
    if (isFinalHop && m.dest() !== '') {
      // send to single destination
      try {
        m.dest() !== m.origin() && this.samUDP.send(this.server.getBlockchain().getPeer(m.dest()).udp, msg);
      } catch (error: any) {
        Logger.warn(`Network.broadcast() ${error.toString()}`);
      }
    } else {
      // broadcast to network
      this.arrayBroadcast.forEach((pk) => {
        try {
          m.origin() !== pk && this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, msg);
        } catch (error: any) {
          Logger.warn(`Network.broadcast() ${error.toString()}`);
        }
      });
    }
  }

  async fetchFromApi(endpoint: string, timeout: number = 0): Promise<any> {
    if (endpoint.indexOf('http://') === 0) {
      try {
        const json: string = await this.fetch(endpoint);
        return JSON.parse(json);
      } catch (error: any) {
        Logger.warn(`Network.fetchFromApi() ${endpoint} - ${error.toString()}`);
      }
    } else if (this.mapOnline.size) {
      const aNetwork: Array<Peer> = Util.shuffleArray(
        this.arrayNetwork.filter((v: Peer) => v.http !== this.server.config.http)
      );
      let urlApi: string = '';
      let p: Peer | undefined = aNetwork.pop();

      while (p) {
        urlApi = `http://${toB32(p.http)}.b32.i2p/${endpoint}`;
        try {
          return JSON.parse(await this.fetch(urlApi, timeout));
        } catch (error: any) {
          Logger.warn(`Network.fetchFromApi() ${urlApi} - ${error.toString()}`);
        }
        p = aNetwork.pop();
      }
    } else {
      Logger.warn('Network unavailable');
    }
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
