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

import { Config } from '../config';
import { Logger } from '../logger';
import { Auth } from './message/auth';
import { Challenge } from './message/challenge';
import { Message } from './message/message';
import { nanoid } from 'nanoid';
import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import { Wallet } from '../chain/wallet';
import { Validation } from './validation';
import { Util } from '../chain/util';

const WS_CLIENT_OPTIONS = {
  compress: true,
  binary: true,
};

export type NetworkPeer = {
  host: string;
  port: number;
};

interface Peer {
  address: string;
  alive: number;
  ws: WebSocket;
}

export class Network {
  private readonly config: Config;
  private readonly wallet: Wallet;
  private readonly identity: string;
  private readonly mapPeer: Map<string, NetworkPeer> = new Map();
  private arrayPeerNetwork: Array<string> = [];

  private readonly wss: WebSocket.Server;

  private peersIn: { [publicKey: string]: Peer } = {};
  private peersOut: { [publicKey: string]: Peer } = {};

  private readonly _onMessage: Function | false;
  private mapGossip: { [publicKeyPeer: string]: Array<string> } = {};

  constructor(config: Config, wallet: Wallet, onMessage: Function) {
    this.config = config;
    this._onMessage = onMessage || false;

    this.wallet = wallet;
    this.identity = this.wallet.getPublicKey();

    Validation.init();

    this.wss = new WebSocket.Server({
      host: this.config.p2p_ip,
      port: this.config.p2p_port,
      clientTracking: false,
      perMessageDeflate: config.per_message_deflate,
    });

    Logger.info(`Identity: ${this.identity}`);

    // incoming connection
    this.wss.on('connection', (ws, request) => {
      const publicKey = request.headers['diva-identity']?.toString() || '';
      const origin = request.headers['diva-origin']?.toString() || '';

      if (publicKey && origin) {
        this.auth(ws, publicKey, origin);
      } else {
        Logger.warn('Connection credentials missing (diva-identity, diva-origin)');
      }
    });

    this.wss.on('error', (error: Error) => {
      Logger.warn('WebsocketServer error');
      Logger.trace(error);
    });

    this.wss.on('listening', () => {
      const wsa = this.wss.address() as WebSocket.AddressInfo;
      Logger.info(`WebSocket.Server listening on ${wsa.address}:${wsa.port}`);
    });

    this.wss.on('close', () => {
      Logger.info('P2P WebSocket Server closed');
    });

    setTimeout(() => this.morphPeerNetwork(), this.config.network_refresh_interval_ms - 1);
    setTimeout(() => this.refresh(), this.config.network_refresh_interval_ms);
    setTimeout(() => this.ping(), this.config.network_ping_interval_ms);
    setTimeout(() => this.clean(), this.config.network_clean_interval_ms);
  }

  async shutdown(): Promise<void> {
    if (typeof this.wss !== 'undefined' && this.wss) {
      Object.values(this.peersOut)
        .concat(Object.values(this.peersIn))
        .forEach((peer) => {
          peer.ws.close(1000, 'Bye');
        });

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.wss.close();
          resolve();
        }, 30000);
        this.wss.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  getIdentity(): string {
    return this.identity;
  }

  addPeer(publicKey: string, peer: NetworkPeer): boolean {
    if (this.mapPeer.has(publicKey)) {
      return false;
    }

    this.mapPeer.set(publicKey, peer);

    // initialize gossip map
    publicKey !== this.identity && (this.mapGossip[publicKey] = []);

    return false;
  }

  removePeer(publicKey: string): Network {
    if (!this.mapPeer.has(publicKey)) {
      return this;
    }

    this.peersIn[publicKey] && this.peersIn[publicKey].ws.close(1000, 'Bye');
    this.peersOut[publicKey] && this.peersOut[publicKey].ws.close(1000, 'Bye');

    delete this.mapGossip[publicKey];
    this.mapPeer.delete(publicKey);

    return this;
  }

  getQuorum(): number {
    return 2 * (this.mapPeer.size / 3); // PBFT
  }

  health() {
    const arrayIn = Object.keys(this.peersIn);
    const arrayOut = Object.keys(this.peersOut);
    const lN = [...new Set(arrayIn.concat(arrayOut))].length;
    const lC = this.mapPeer.size - 1; // -1: exclude self
    return { in: arrayIn.length / lC, out: arrayOut.length / lC, total: lN / lC };
  }

  peers() {
    const peers: { net: Array<string>; in: Array<object>; out: Array<object> } = {
      net: this.arrayPeerNetwork,
      in: [],
      out: [],
    };
    Object.keys(this.peersIn).forEach((p) => {
      peers.in.push({ publicKey: p, address: this.peersIn[p].address, alive: this.peersIn[p].alive });
    });
    Object.keys(this.peersOut).forEach((p) => {
      peers.out.push({ publicKey: p, address: this.peersOut[p].address, alive: this.peersOut[p].alive });
    });
    return peers;
  }

  network(): Array<string> {
    return [...this.mapPeer.keys()];
  }

  gossip(): { [publicKey: string]: Array<string> } {
    return this.mapGossip;
  }

  stopGossip(ident: string) {
    Object.keys(this.mapGossip).forEach((publicKeyPeer) => {
      !this.mapGossip[publicKeyPeer].includes(ident) && this.mapGossip[publicKeyPeer].push(ident);
    });
  }

  processMessage(message: Buffer | string, publicKeyPeer: string = '', retry: number = 0) {
    const m = new Message(message);
    const ident = m.ident();

    if (!Validation.validateMessage(m)) {
      return this.stopGossip(ident);
    }

    // populate Gossiping map
    if (publicKeyPeer && publicKeyPeer !== this.identity && !this.mapGossip[publicKeyPeer].includes(ident)) {
      this.mapGossip[publicKeyPeer].push(ident);
    }
    const origin = m.origin();
    if (origin && origin !== this.identity && !this.mapGossip[origin].includes(ident)) {
      this.mapGossip[origin].push(ident);
    }

    // process message handler callback
    if (this._onMessage) {
      this._onMessage(m.type(), message);
    }

    // broadcasting / gossip
    if (m.isBroadcast() && !this.broadcast(m)) {
      retry = retry > 0 ? retry : 0;
      if (retry < 50) {
        setTimeout(() => {
          this.processMessage(message, publicKeyPeer, retry + 1);
        }, (retry + 1) * 250);
      } else {
        //@FIXME logging
        Logger.trace('!! Retry timed out');
      }
    }
  }

  private broadcast(m: Message): boolean {
    const ident = m.ident();
    const arrayBroadcast = [...new Set(Object.keys(this.peersOut).concat(Object.keys(this.peersIn)))].filter((_pk) => {
      return _pk !== this.identity && !this.mapGossip[_pk].includes(ident);
    });

    let doRetry = false;
    for (const _pk of arrayBroadcast) {
      try {
        if (this.peersOut[_pk] && this.peersOut[_pk].ws.readyState === 1) {
          Network.send(this.peersOut[_pk].ws, m.pack());
        } else if (this.peersIn[_pk] && this.peersIn[_pk].ws.readyState === 1) {
          Network.send(this.peersIn[_pk].ws, m.pack());
        } else {
          doRetry = true;
          continue;
        }
        !this.mapGossip[_pk].includes(ident) && this.mapGossip[_pk].push(ident);
      } catch (error) {
        Logger.warn('broadcast(): Websocket Error');
        Logger.trace(JSON.stringify(error));
        doRetry = true;
      }
    }

    return !doRetry;
  }

  private auth(ws: WebSocket, publicKeyPeer: string, origin: string) {
    if (this.peersIn[publicKeyPeer]) {
      this.peersIn[publicKeyPeer].ws.close(4005, 'Rebuilding');
      delete this.peersIn[publicKeyPeer];
    }

    const timeout = setTimeout(() => {
      ws.close(4005, 'Auth Timeout');
    }, this.config.network_auth_timeout_ms);

    const challenge = nanoid(26);
    Network.send(ws, new Challenge().create(challenge).pack());

    ws.once('message', (message: Buffer) => {
      clearTimeout(timeout);

      const mA = new Auth(message);
      if (!Validation.validateMessage(mA) || !mA.isValid(challenge, publicKeyPeer)) {
        return ws.close(4003, 'Auth Failed');
      }

      this.peersIn[publicKeyPeer] = {
        address: 'ws://' + origin,
        alive: Date.now(),
        ws: ws,
      };

      ws.on('error', () => {
        ws.close();
      });
      ws.on('close', () => {
        delete this.peersIn[publicKeyPeer];
      });
      ws.on('message', (message: Buffer) => {
        if (this.peersIn[publicKeyPeer]) {
          this.peersIn[publicKeyPeer].alive = Date.now();
          this.processMessage(message, publicKeyPeer);
        }
      });
      ws.on('pong', () => {
        this.peersIn[publicKeyPeer] && (this.peersIn[publicKeyPeer].alive = Date.now());
      });
    });
  }

  private refresh() {
    for (const publicKey of this.arrayPeerNetwork) {
      if (publicKey !== this.identity && !this.peersOut[publicKey]) {
        this.connect(publicKey);
      }
    }
    setTimeout(() => this.refresh(), this.config.network_refresh_interval_ms);
  }

  private morphPeerNetwork() {
    if (this.mapPeer.size < 1) {
      return;
    }

    const arrayPublicKey: Array<string> = Array.from(this.mapPeer.keys());
    if (arrayPublicKey.length <= this.config.network_size) {
      this.arrayPeerNetwork = [...arrayPublicKey];
      return;
    }

    this.arrayPeerNetwork = this.arrayPeerNetwork.concat(
      Util.shuffleArray(arrayPublicKey).slice(
        0,
        this.arrayPeerNetwork.length >= this.config.network_size
          ? Math.floor(this.config.network_size / 2)
          : this.config.network_size
      )
    );

    while (this.arrayPeerNetwork.length > this.config.network_size) {
      const publicKey = this.arrayPeerNetwork.shift();
      publicKey && this.peersOut[publicKey] && this.peersOut[publicKey].ws.close(1000, 'Bye');
    }

    setTimeout(() => {
      this.morphPeerNetwork();
    }, this.config.network_morph_interval_ms);
  }

  private clean() {
    const t = Date.now() - this.config.network_clean_interval_ms * 2; // timeout
    for (const publicKey in this.peersOut) {
      if (this.peersOut[publicKey].alive < t) {
        this.peersOut[publicKey].ws.close(4002, 'Timeout');
      }
    }
    for (const publicKey in this.peersIn) {
      if (this.peersIn[publicKey].alive < t) {
        this.peersIn[publicKey].ws.close(4002, 'Timeout');
      }
    }

    Object.keys(this.mapGossip).forEach((publicKeyPeer) => {
      if (this.mapGossip[publicKeyPeer].length > this.config.network_max_size_gossip_stack) {
        this.mapGossip[publicKeyPeer].splice(0, Math.floor(this.mapGossip[publicKeyPeer].length / 3));
      }
    });

    setTimeout(() => this.clean(), this.config.network_clean_interval_ms);
  }

  private connect(publicKeyPeer: string) {
    const peer = this.mapPeer.get(publicKeyPeer) || ({} as NetworkPeer);
    if (!peer.host) {
      return;
    }
    const address = 'ws://' + peer.host + ':' + peer.port;
    const options: WebSocket.ClientOptions = {
      followRedirects: false,
      perMessageDeflate: this.config.per_message_deflate,
      headers: {
        'diva-identity': this.identity,
        'diva-origin': this.config.p2p_ip + ':' + this.config.p2p_port,
      },
    };

    if (this.config.socks_proxy_host && this.config.socks_proxy_port > 0 && /\.i2p$/.test(peer.host)) {
      options.agent = new SocksProxyAgent(`socks://${this.config.socks_proxy_host}:${this.config.socks_proxy_port}`);
    }

    const ws = new WebSocket(address, options);
    this.peersOut[publicKeyPeer] = {
      address: address,
      alive: Date.now(),
      ws: ws,
    };

    ws.on('close', () => {
      delete this.peersOut[publicKeyPeer];
    });
    ws.on('error', () => {
      ws.close();
    });
    ws.once('message', (message: Buffer) => {
      const mC = new Challenge(message);
      if (!Validation.validateMessage(mC) || !mC.isValid()) {
        return ws.close(4003, 'Challenge Failed');
      }
      Network.send(ws, new Auth().create(this.wallet.sign(mC.getChallenge())).pack());

      ws.on('message', (message: Buffer) => {
        if (this.peersOut[publicKeyPeer]) {
          this.peersOut[publicKeyPeer].alive = Date.now();
          this.processMessage(message, publicKeyPeer);
        }
      });
      ws.on('pong', () => {
        this.peersOut[publicKeyPeer] && (this.peersOut[publicKeyPeer].alive = Date.now());
      });
    });
  }

  private ping(): void {
    const t = Date.now() - this.config.network_ping_interval_ms;
    for (const publicKey in this.peersIn) {
      this.peersIn[publicKey].ws.readyState === 1 &&
        this.peersIn[publicKey].alive < t &&
        this.peersIn[publicKey].ws.ping();
    }
    for (const publicKey in this.peersOut) {
      this.peersOut[publicKey].ws.readyState === 1 &&
        this.peersOut[publicKey].alive < t &&
        this.peersOut[publicKey].ws.ping();
    }

    setTimeout(() => this.ping(), this.config.network_ping_interval_ms);
  }

  private static send(ws: WebSocket, data: string) {
    ws.send(data, WS_CLIENT_OPTIONS);
  }
}
