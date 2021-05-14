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
import { Auth } from './message/auth';
import { Challenge } from './message/challenge';
import { Message } from './message/message';
import { nanoid } from 'nanoid';
import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import { Validation } from './validation';
import { Util } from '../chain/util';
import { Server } from './server';
import { Sync } from './message/sync';

const GOSSIP_MAX_MESSAGES_PER_PEER = 250;

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
  private readonly server: Server;
  private readonly identity: string;
  private readonly mapPeer: Map<string, NetworkPeer> = new Map();
  private arrayPeerNetwork: Array<string> = [];

  private readonly wss: WebSocket.Server;

  private peersIn: { [publicKey: string]: Peer } = {};
  private peersOut: { [publicKey: string]: Peer } = {};

  private readonly _onMessage: Function | false;
  private aGossip: { [publicKeyPeer: string]: Array<string> } = {};

  constructor(server: Server, onMessage: Function) {
    this.server = server;
    this._onMessage = onMessage || false;

    this.identity = this.server.wallet.getPublicKey();

    Validation.init();

    this.wss = new WebSocket.Server({
      host: this.server.config.p2p_ip,
      port: this.server.config.p2p_port,
      clientTracking: false,
      perMessageDeflate: this.server.config.per_message_deflate,
    });

    Logger.info(`Identity: ${this.identity}`);

    // incoming connection
    this.wss.on('connection', (ws, request) => {
      const publicKey = request.headers['diva-identity']?.toString() || '';

      if (publicKey && publicKey !== this.identity && this.network().indexOf(publicKey) > -1) {
        this.auth(ws, publicKey);
      } else {
        Logger.warn('Connection credentials missing (diva-identity)');
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

    setTimeout(() => this.morphPeerNetwork(), this.server.config.network_refresh_interval_ms - 1);
    setTimeout(() => this.refresh(), this.server.config.network_refresh_interval_ms);
    setTimeout(() => this.ping(), this.server.config.network_ping_interval_ms);
    setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
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
    publicKey !== this.identity && (this.aGossip[publicKey] = []);

    return false;
  }

  removePeer(publicKey: string): Network {
    if (!this.mapPeer.has(publicKey)) {
      return this;
    }

    this.peersIn[publicKey] && this.peersIn[publicKey].ws.close(1000, 'Bye');
    this.peersOut[publicKey] && this.peersOut[publicKey].ws.close(1000, 'Bye');

    delete this.aGossip[publicKey];
    this.mapPeer.delete(publicKey);

    return this;
  }

  getQuorum(): number {
    return 2 * (this.mapPeer.size / 3); // PBFT
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
    return this.aGossip;
  }

  stopGossip(ident: string) {
    Object.keys(this.aGossip).forEach((publicKeyPeer) => {
      !this.aGossip[publicKeyPeer].includes(ident) && this.aGossip[publicKeyPeer].push(ident);
    });
  }

  resetGossip() {
    Object.keys(this.aGossip).forEach((publicKeyPeer) => {
      this.aGossip[publicKeyPeer] = [];
    });
  }

  processMessage(message: Buffer | string, publicKeyPeer: string = '') {
    const m = new Message(message);
    const ident = m.ident();
    this.server.config.network_verbose_logging &&
      Logger.trace(`Network.processMessage: ${JSON.stringify(m.getMessage())}`);

    if (!Validation.validateMessage(m)) {
      return this.stopGossip(ident);
    }

    // populate Gossiping map
    if (publicKeyPeer && publicKeyPeer !== this.identity && !this.aGossip[publicKeyPeer].includes(ident)) {
      this.aGossip[publicKeyPeer].push(ident);
    }
    const origin = m.origin();
    if (origin && origin !== this.identity && !this.aGossip[origin].includes(ident)) {
      this.aGossip[origin].push(ident);
    }

    // process message handler callback
    this._onMessage && this._onMessage(m.type(), message);

    // broadcasting / gossip
    m.isBroadcast() && this.broadcast(m);
  }

  private broadcast(m: Message) {
    const ident = m.ident();
    const arrayBroadcast = [...new Set(Object.keys(this.peersOut).concat(Object.keys(this.peersIn)))].filter((_pk) => {
      return _pk !== this.identity && !this.aGossip[_pk].includes(ident);
    });

    for (const _pk of arrayBroadcast) {
      try {
        if (this.peersOut[_pk] && this.peersOut[_pk].ws.readyState === 1) {
          Network.send(this.peersOut[_pk].ws, m.pack());
        } else if (this.peersIn[_pk] && this.peersIn[_pk].ws.readyState === 1) {
          Network.send(this.peersIn[_pk].ws, m.pack());
        } else {
          continue;
        }
        !this.aGossip[_pk].includes(ident) && this.aGossip[_pk].push(ident);
      } catch (error) {
        Logger.warn('broadcast(): Websocket Error');
        Logger.trace(JSON.stringify(error));
      }
    }
  }

  private auth(ws: WebSocket, publicKeyPeer: string) {
    if (this.peersIn[publicKeyPeer]) {
      this.peersIn[publicKeyPeer].ws.close(4005, 'Rebuilding');
      delete this.peersIn[publicKeyPeer];
    }

    const timeout = setTimeout(() => {
      ws.close(4005, 'Auth Timeout');
    }, this.server.config.network_auth_timeout_ms);

    const challenge = nanoid(26);
    Network.send(ws, new Challenge().create(challenge).pack());

    ws.once('message', (message: Buffer) => {
      clearTimeout(timeout);

      const peer = this.mapPeer.get(publicKeyPeer) || ({} as NetworkPeer);
      const mA = new Auth(message);
      if (!peer.host || !Validation.validateMessage(mA) || !mA.isValid(challenge, publicKeyPeer)) {
        return ws.close(4003, 'Auth Failed');
      }

      this.peersIn[publicKeyPeer] = {
        address: 'ws://' + peer.host + ':' + peer.port,
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
      ws.on('ping', async (data) => {
        if (Number(data.toString()) < this.server.blockchain.getHeight() - this.server.config.network_sync_threshold) {
          const sync = this.getSync(Number(data.toString()));
          Network.send(ws, sync.pack());
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
    setTimeout(() => this.refresh(), this.server.config.network_refresh_interval_ms);
  }

  private morphPeerNetwork() {
    if (this.mapPeer.size < 1) {
      return;
    }

    const arrayPublicKey: Array<string> = Array.from(this.mapPeer.keys());
    if (arrayPublicKey.length <= this.server.config.network_size) {
      this.arrayPeerNetwork = [...arrayPublicKey];
      return;
    }

    this.arrayPeerNetwork = this.arrayPeerNetwork.concat(
      Util.shuffleArray(arrayPublicKey).slice(
        0,
        this.arrayPeerNetwork.length >= this.server.config.network_size
          ? Math.floor(this.server.config.network_size / 2)
          : this.server.config.network_size
      )
    );

    while (this.arrayPeerNetwork.length > this.server.config.network_size) {
      const publicKey = this.arrayPeerNetwork.shift();
      publicKey && this.peersOut[publicKey] && this.peersOut[publicKey].ws.close(1000, 'Bye');
    }

    setTimeout(() => {
      this.morphPeerNetwork();
    }, this.server.config.network_morph_interval_ms);
  }

  private clean() {
    const t = Date.now() - this.server.config.network_clean_interval_ms * 2; // timeout
    Object.values(this.peersOut)
      .concat(Object.values(this.peersIn))
      .forEach((peer) => {
        peer.alive < t && peer.ws.close(4002, 'Timeout');
      });

    const drop = Math.floor(GOSSIP_MAX_MESSAGES_PER_PEER / 2);
    Object.keys(this.aGossip).forEach((publicKeyPeer) => {
      if (this.aGossip[publicKeyPeer].length / 2 > drop) {
        this.aGossip[publicKeyPeer].splice(0, this.aGossip[publicKeyPeer].length - drop);
      }
    });

    setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  private connect(publicKeyPeer: string) {
    const peer = this.mapPeer.get(publicKeyPeer) || ({} as NetworkPeer);
    if (!peer.host) {
      return;
    }
    const address = 'ws://' + peer.host + ':' + peer.port;
    const options: WebSocket.ClientOptions = {
      followRedirects: false,
      perMessageDeflate: this.server.config.per_message_deflate,
      headers: {
        'diva-identity': this.identity,
      },
    };

    if (this.server.config.socks_proxy_host && this.server.config.socks_proxy_port > 0 && /\.i2p$/.test(peer.host)) {
      options.agent = new SocksProxyAgent(
        `socks://${this.server.config.socks_proxy_host}:${this.server.config.socks_proxy_port}`
      );
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
      Network.send(ws, new Auth().create(this.server.wallet.sign(mC.getChallenge())).pack());

      ws.on('message', (message: Buffer) => {
        if (this.peersOut[publicKeyPeer]) {
          this.peersOut[publicKeyPeer].alive = Date.now();
          this.processMessage(message, publicKeyPeer);
        }
      });
      ws.on('ping', (data) => {
        if (Number(data.toString()) < this.server.blockchain.getHeight() - this.server.config.network_sync_threshold) {
          const sync = this.getSync(Number(data.toString()));
          Network.send(ws, sync.pack());
        }
      });
      ws.on('pong', () => {
        this.peersOut[publicKeyPeer] && (this.peersOut[publicKeyPeer].alive = Date.now());
      });
    });
  }

  private ping(): void {
    const i = this.server.config.network_ping_interval_ms;
    let t = i;
    Util.shuffleArray(Object.values(this.peersOut).concat(Object.values(this.peersIn))).forEach((peer) => {
      setTimeout(() => {
        peer.ws.readyState === 1 && peer.ws.ping(this.server.blockchain.getHeight());
      }, t);
      t = t + i;
    });

    setTimeout(() => this.ping(), t);
  }

  private getSync(height: number): Sync {
    const arrayBlocks = this.server.blockchain.get(0, height, height + this.server.config.network_sync_size);
    return new Sync().create(arrayBlocks.reverse());
  }

  private static send(ws: WebSocket, data: string) {
    ws.send(data, WS_CLIENT_OPTIONS);
  }
}
