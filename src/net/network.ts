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

import { Auth } from './message/auth';
import { Challenge } from './message/challenge';
import { Logger } from '../logger';
import { Message } from './message/message';
import { nanoid } from 'nanoid';
import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import { Wallet } from '../chain/wallet';
import { Blockchain } from '../chain/blockchain';
import { Validation } from './validation';
import { PER_MESSAGE_DEFLATE } from '../config';

const SOCKS_PROXY_HOST = process.env.SOCKS_PROXY_HOST || '172.20.101.201';
const SOCKS_PROXY_PORT = Number(process.env.SOCKS_PROXY_PORT) || 4445;

const REFRESH_INTERVAL_MS = 3000; // 3 secs
const TIMEOUT_AUTH_MS = REFRESH_INTERVAL_MS * 10;
const CLEAN_INTERVAL_MS = 60000; // 1 minute
const PING_INTERVAL_MS = Math.floor(CLEAN_INTERVAL_MS / 2); // must be significantly lower than CLEAN_INTERVAL_MS

const MAX_SIZE_GOSSIP_STACK = 1000;

const WS_CLIENT_OPTIONS = {
  compress: true,
  binary: true,
};

type NetworkPeer = {
  host: string;
  port: number;
};

type configNetwork = {
  ip?: string;
  port?: number;
  networkPeers?: { [publicKey: string]: NetworkPeer };
  onMessageCallback?: Function;
};

interface Peer {
  address: string;
  alive: number;
  ws: WebSocket;
}

export class Network {
  private readonly blockchain: Blockchain;
  private readonly wallet: Wallet;
  private readonly identity: string;
  private readonly ip: string;
  private readonly port: number;
  private readonly networkPeers: { [publicKey: string]: NetworkPeer };

  private readonly wss: WebSocket.Server;

  private peersIn: { [publicKey: string]: Peer } = {};
  private peersOut: { [publicKey: string]: Peer } = {};

  private readonly _onMessage: Function | false;
  private mapGossip: { [publicKeyPeer: string]: Array<string> } = {};

  constructor(config: configNetwork, blockchain: Blockchain, wallet: Wallet) {
    this.ip = config.ip || '127.0.0.1';
    const _port = config.port || 17468;
    this.port = _port >= 1024 && _port <= 49151 ? _port : 17468;
    this.networkPeers = config.networkPeers || {};
    this._onMessage = config.onMessageCallback || false;

    this.wallet = wallet;
    this.identity = this.wallet.getPublicKey();
    if (!this.networkPeers[this.identity]) {
      throw new Error(`Invalid identity ${this.identity}`);
    }

    Validation.init();
    this.blockchain = blockchain;

    // init Gossipping map of complete known network
    Object.keys(this.networkPeers).forEach((_pk) => {
      _pk !== this.identity && (this.mapGossip[_pk] = []);
    });

    /*
    //@FIXME testing subnet
    const a = Object.keys(this.networkPeers);
    let i = 0;
    while (i < 2) {
      const k = a[Math.floor(Math.random() * a.length)];
      if (k !== this.identity && this.networkPeers[k]) {
        delete this.networkPeers[k];
        i++;
      }
    }
    */

    Logger.info(`Identity: ${this.identity}`);
    Logger.info(`Network: ${JSON.stringify(this.networkPeers)}`);

    this.wss = new WebSocket.Server({
      host: this.ip,
      port: this.port,
      clientTracking: false,
      perMessageDeflate: PER_MESSAGE_DEFLATE,
    });

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

    setTimeout(() => this.refresh(), REFRESH_INTERVAL_MS);
    setTimeout(() => this.ping(), PING_INTERVAL_MS);
    setTimeout(() => this.clean(), CLEAN_INTERVAL_MS);
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

  health() {
    const arrayIn = Object.keys(this.peersIn);
    const arrayOut = Object.keys(this.peersOut);
    const lN = [...new Set(arrayIn.concat(arrayOut))].length;
    const lC = Object.keys(this.networkPeers).length - 1; // -1: exclude self
    return { in: arrayIn.length / lC, out: arrayOut.length / lC, total: lN / lC };
  }

  peers() {
    const peers: { in: Array<object>; out: Array<object> } = {
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
    return Object.keys(this.networkPeers);
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

  /*
  addPeer(host: string, port: number, publicKey: string): Network {
    if (this.networkPeers[publicKey]) {
      throw new Error('Peer already available');
    }

    this.networkPeers[publicKey] = {
      host: host,
      port: port,
    };
    return this;
  }

  removePeer(publicKey: string): Network {
    delete this.networkPeers[publicKey];
    this.peers[publicKey]?.ws?.close(1000, 'Bye');
    delete this.peers[publicKey];
    return this;
  }
  */

  private auth(ws: WebSocket, publicKeyPeer: string, origin: string) {
    if (this.peersIn[publicKeyPeer]) {
      this.peersIn[publicKeyPeer].ws.close(4005, 'Rebuilding');
      delete this.peersIn[publicKeyPeer];
    }

    const timeout = setTimeout(() => {
      ws.close(4005, 'Auth Timeout');
    }, TIMEOUT_AUTH_MS);

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

  private async refresh() {
    for (const publicKey in this.networkPeers) {
      if (publicKey !== this.identity && !this.peersOut[publicKey]) {
        this.connect(publicKey);
      }
    }
    setTimeout(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  private clean() {
    const t = Date.now() - CLEAN_INTERVAL_MS * 2; // timeout
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
      if (this.mapGossip[publicKeyPeer].length > MAX_SIZE_GOSSIP_STACK) {
        this.mapGossip[publicKeyPeer].splice(0, Math.floor(this.mapGossip[publicKeyPeer].length / 3));
      }
    });

    setTimeout(() => this.clean(), CLEAN_INTERVAL_MS);
  }

  private connect(publicKeyPeer: string) {
    const address = 'ws://' + this.networkPeers[publicKeyPeer].host + ':' + this.networkPeers[publicKeyPeer].port;
    const options: WebSocket.ClientOptions = {
      followRedirects: false,
      perMessageDeflate: PER_MESSAGE_DEFLATE,
      headers: {
        'diva-identity': this.identity,
        'diva-origin': this.networkPeers[this.identity].host + ':' + this.networkPeers[this.identity].port,
      },
    };

    if (/\.i2p$/.test(this.networkPeers[publicKeyPeer].host)) {
      options.agent = new SocksProxyAgent(`socks://${SOCKS_PROXY_HOST}:${SOCKS_PROXY_PORT}`);
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
    const t = Date.now() - PING_INTERVAL_MS;
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

    setTimeout(() => this.ping(), PING_INTERVAL_MS);
  }

  private static send(ws: WebSocket, data: string) {
    ws.send(data, WS_CLIENT_OPTIONS);
  }
}
