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

import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import { Logger } from '../logger';
import { nanoid } from 'nanoid';
import * as sodium from 'sodium-native';
import { Auth } from './message/auth';
import { Challenge } from './message/challenge';
import { Message } from './message/message';

const SOCKS_PROXY_HOST = process.env.SOCKS_PROXY_HOST || '172.17.0.2';
const SOCKS_PROXY_PORT = Number(process.env.SOCKS_PROXY_PORT) || 4445;

const REFRESH_INTERVAL_MS = 3000; // 3 secs
const TIMEOUT_AUTH_MS = REFRESH_INTERVAL_MS * 10;
const PING_INTERVAL_MS = REFRESH_INTERVAL_MS * 10;
const CLEAN_INTERVAL_MS = REFRESH_INTERVAL_MS * 15;

type NetworkPeer = {
  host: string;
  port: number;
};

type Config = {
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
  private readonly identity: string;
  private readonly ip: string;
  private readonly port: number;
  private readonly networkPeers: { [publicKey: string]: NetworkPeer };

  private readonly wss: WebSocket.Server;

  peersIn: { [publicKey: string]: Peer } = {};
  peersOut: { [publicKey: string]: Peer } = {};

  private readonly publicKey: Buffer;
  private readonly secretKey: Buffer;

  private readonly _onMessage: Function | false;

  constructor(config: Config) {
    this.ip = config.ip || '127.0.0.1';
    const _port = config.port || 17468;
    this.port = _port >= 1024 && _port <= 49151 ? _port : 17468;
    this.networkPeers = config.networkPeers || {};
    this._onMessage = config.onMessageCallback || false;

    const bufferSeed: Buffer = sodium.sodium_malloc(sodium.crypto_sign_SEEDBYTES);
    sodium.sodium_mlock(bufferSeed);
    //@FIXME
    bufferSeed.fill(this.ip + this.port);

    this.publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
    this.secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.sodium_mlock(this.secretKey);

    sodium.crypto_sign_seed_keypair(this.publicKey, this.secretKey, bufferSeed);

    this.identity = this.publicKey.toString('base64');
    if (!this.networkPeers[this.identity]) {
      throw new Error(`Invalid identity ${this.identity}`);
    }

    Logger.info(`Identity: ${this.identity}`);
    Logger.info(`Network: ${JSON.stringify(this.networkPeers)}`);

    this.wss = new WebSocket.Server({
      host: this.ip,
      port: this.port,
      clientTracking: false,
      perMessageDeflate: false,
    });

    // incoming connection
    this.wss.on('connection', (ws, request) => {
      const publicKey = request.headers['diva-identity']?.toString() || '';
      const origin = request.headers['diva-origin']?.toString() || '';

      this.auth(ws, publicKey, origin);
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

    setTimeout(async () => {
      await this.refresh();
    }, REFRESH_INTERVAL_MS);
    setTimeout(() => {
      this.ping();
    }, PING_INTERVAL_MS);
    setTimeout(() => {
      this.cleanNetwork();
    }, CLEAN_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (typeof this.wss !== 'undefined' && this.wss) {
      await new Promise((resolve) => {
        Object.values(this.peersOut).forEach((peer) => {
          peer.ws.close(1000, 'Bye');
        });
        Object.values(this.peersIn).forEach((peer) => {
          peer.ws.close(1000, 'Bye');
        });
        this.wss.close(resolve);
      });
    }
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
  broadcast(message: Message) {
    if (message.isBroadcast()) {
      Object.keys(this.peersOut)
        .filter((publicKey) => !message.hasTrail(publicKey))
        .forEach(async (publicKey) => {
          try {
            if (this.peersOut[publicKey] && this.peersOut[publicKey].ws.readyState === 1) {
              const s = message.pack(this.identity);
              await this.peersOut[publicKey].ws.send(s);
            }
          } catch (error) {
            //@FIXME why is the websocket throwing an Exception?
            Logger.warn('broadcast(): Websocket Error');
            Logger.trace(JSON.stringify(error));
          }
        });
    }
  }

  private auth(ws: WebSocket, publicKey: string, origin: string) {
    if (!publicKey || !origin || !this.networkPeers[publicKey] || this.peersIn[publicKey]) {
      return ws.close(4003, 'Denied');
    }

    const timeout = setTimeout(() => {
      ws.close(4005, 'Auth Timeout');
    }, TIMEOUT_AUTH_MS);

    const challenge = nanoid();
    ws.send(new Challenge().create(challenge).pack());

    ws.once('message', (message: Buffer) => {
      clearTimeout(timeout);

      if (!new Auth(message).verify(challenge, publicKey)) {
        return ws.close(4003, 'Auth Failed');
      }

      this.peersIn[publicKey] = {
        address: 'ws://' + origin,
        alive: Date.now(),
        ws: ws,
      };

      ws.on('message', (message: Buffer) => {
        this.peersIn[publicKey] && (this.peersIn[publicKey].alive = Date.now());
        this._onMessage && this._onMessage(message);
      });
      ws.on('error', () => {
        ws.close();
      });
      ws.on('close', () => {
        delete this.peersIn[publicKey];
      });
      ws.on('pong', () => {
        this.peersIn[publicKey] &&
          this.peersIn[publicKey].ws.readyState === 1 &&
          (this.peersIn[publicKey].alive = Date.now());
      });
    });
  }

  private async refresh() {
    for (const publicKey in this.networkPeers) {
      if (publicKey !== this.identity && !this.peersOut[publicKey]) {
        await this.connect(publicKey);
      }
    }
    setTimeout(async () => {
      await this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  private cleanNetwork() {
    const t = Date.now() - CLEAN_INTERVAL_MS;
    for (const publicKey in this.peersOut) {
      if (this.peersOut[publicKey].alive < t) {
        this.peersOut[publicKey].ws.close(4002, 'Timeout');
        delete this.peersOut[publicKey];
      }
    }
    for (const publicKey in this.peersIn) {
      if (this.peersIn[publicKey].alive < t) {
        this.peersIn[publicKey].ws.close(4002, 'Timeout');
        delete this.peersIn[publicKey];
      }
    }

    setTimeout(() => {
      this.cleanNetwork();
    }, CLEAN_INTERVAL_MS);
  }

  private connect(publicKey: string): Promise<void> {
    return new Promise((resolve) => {
      const address = 'ws://' + this.networkPeers[publicKey].host + ':' + this.networkPeers[publicKey].port;
      const options: WebSocket.ClientOptions = {
        followRedirects: false,
        perMessageDeflate: false,
        headers: {
          'diva-identity': this.identity,
          'diva-origin': this.networkPeers[this.identity].host + ':' + this.networkPeers[this.identity].port,
        },
        agent: new SocksProxyAgent(`socks://${SOCKS_PROXY_HOST}:${SOCKS_PROXY_PORT}`),
      };

      const ws = new WebSocket(address, options);
      this.peersOut[publicKey] = {
        address: address,
        alive: Date.now(),
        ws: ws,
      };

      ws.on('open', () => {
        resolve();
      });
      ws.on('close', () => {
        delete this.peersOut[publicKey];
        resolve();
      });
      ws.on('error', () => {
        ws.close();
      });
      ws.once('message', (message: Buffer) => {
        const challenge = new Challenge(message);
        if (!challenge.verify()) {
          return ws.close(4003, 'Challenge Failed');
        }
        ws.send(new Auth().create(challenge.getChallenge(), this.secretKey).pack());

        ws.on('message', (message: Buffer) => {
          this.peersOut[publicKey] && (this.peersOut[publicKey].alive = Date.now());
          this._onMessage && this._onMessage(message);
        });
        ws.on('pong', () => {
          this.peersOut[publicKey] &&
            this.peersOut[publicKey].ws.readyState === 1 &&
            (this.peersOut[publicKey].alive = Date.now());
        });
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

    setTimeout(() => {
      this.ping();
    }, PING_INTERVAL_MS);
  }
}
