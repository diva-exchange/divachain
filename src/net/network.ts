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
import { createForward, I2pSamStream } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import net from 'net';
import { Challenge } from './message/challenge';
import { nanoid } from 'nanoid';
import { Auth } from './message/auth';
import { SocksClient, SocksClientOptions } from 'socks';
import { Util } from '../chain/util';
import { CHALLENGE_LENGTH } from '../config';

export class Network extends EventEmitter {
  private readonly server: Server;
  private readonly peer: net.Server;

  private samInbound: I2pSamStream = {} as I2pSamStream;

  private readonly publicKey: string;
  private mapBroadcast: Map<string, net.Socket> = new Map();
  private arrayStackConnect: Array<string> = [];
  private arrayProcessed: Array<string> = [];
  private arrayBroadcasted: Array<string> = [];

  private readonly _onMessage: Function | false;

  private timeoutP2P: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutClean: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server, onMessage: Function) {
    return new Network(server, onMessage);
  }

  private constructor(server: Server, onMessage: Function) {
    super();

    this.server = server;
    this._onMessage = onMessage || false;

    this.publicKey = this.server.getWallet().getPublicKey();
    Logger.info(`Network, public key: ${this.publicKey}`);

    // TCP endpoint
    this.peer = net.createServer((client: net.Socket) => {
      this.inbound(client);
    });

    this.peer.listen(this.server.config.tcp_server_port, this.server.config.tcp_server_ip, () => {
      Logger.info(
        `TCP server listening on ${this.server.config.tcp_server_ip}:${this.server.config.i2p_sam_forward_port}`
      );
    });

    this.init();

    this.timeoutClean = setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  shutdown() {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutClean);

    for (const socket of this.mapBroadcast.values()) {
      socket.destroy();
    }
    this.peer.close();
  }

  private init() {
    let started = false;
    const i = setInterval(async () => {
      if (!started && [...this.server.getBlockchain().getMapPeer().keys()].length > 0) {
        started = true;
        Logger.info(`P2P starting on ${this.server.config.address}`);

        //incoming
        this.samInbound = await createForward({
          sam: {
            host: this.server.config.i2p_sam_host,
            portTCP: this.server.config.i2p_sam_port_tcp,
            publicKey: this.server.config.i2p_public_key,
            privateKey: this.server.config.i2p_private_key,
          },
          forward: {
            host: this.server.config.i2p_sam_forward_host,
            port: this.server.config.i2p_sam_forward_port,
            silent: true,
          },
        });
        Logger.info(`Inbound SAM connection available ${this.server.config.i2p_sam_host}`);

        await this.p2pNetwork();
      }

      if (started) {
        const nq = [...this.mapBroadcast.keys()].reduce((q, pk) => q + this.server.getBlockchain().getStake(pk), 0);
        if (nq * 0.9 >= this.server.getBlockchain().getQuorum()) {
          Logger.info(`P2P ready on ${this.server.config.address}`);
          this.emit('ready');
          clearInterval(i);
        }
      }
    }, 10000);
  }

  private inbound(socket: net.Socket) {
    const challenge = nanoid(CHALLENGE_LENGTH);

    const authTimeout: NodeJS.Timeout = setTimeout(() => {
      socket.destroy();
    }, this.server.config.network_auth_timeout_ms);

    socket.write(new Challenge().create(challenge).pack());
    socket.once('data', (data: Buffer) => {
      let auth: Auth = {} as Auth;
      try {
        clearTimeout(authTimeout);
        auth = new Auth(data);
      } catch (error: any) {
        Logger.warn('Invalid Auth message');
        socket.destroy();
        return;
      }

      if (!auth.isValid(challenge) || this.mapBroadcast.has(auth.origin())) {
        socket.destroy();
        return;
      }

      this.handleIncomingData(socket, auth.origin());
    });
  }

  private outbound(publicKey: string) {
    if (this.arrayStackConnect.includes(publicKey)) {
      return;
    }
    this.arrayStackConnect.push(publicKey);

    (async () => {
      try {
        const options: SocksClientOptions = {
          proxy: {
            host: this.server.config.i2p_socks_host,
            port: this.server.config.i2p_socks_port,
            type: 5,
          },
          command: 'connect',
          destination: {
            host: this.server.getBlockchain().getPeer(publicKey).address,
            port: this.server.config.i2p_sam_forward_port,
          },
          timeout: this.server.config.network_p2p_interval_ms,
        };

        const socket = (await SocksClient.createConnection(options)).socket;
        socket.once('data', (data: Buffer) => {
          // challenge
          try {
            const challenge = new Challenge(data);
            socket.write(
              new Auth().create(this.publicKey, this.server.getWallet().sign(challenge.getChallenge())).pack()
            );
          } catch (error: any) {
            Logger.warn('Invalid Challenge message');
            socket.destroy();
            return;
          }

          this.handleIncomingData(socket, publicKey);
        });
      } catch (error: any) {
        Logger.trace(`Network.outbound(): ${this.server.getBlockchain().getPeer(publicKey).address} - ${error.toString()}`);
      }

      this.arrayStackConnect.splice(this.arrayStackConnect.indexOf(publicKey), 1);
    })();
  }

  private handleIncomingData(socket: net.Socket, pk: string) {
    if (this.mapBroadcast.has(pk)) {
      return socket.destroy();
    }

    let incomingData = '';
    socket.on('data', (data: Buffer) => {
      incomingData += data.toString();
      while (incomingData.indexOf('#') > -1) {
        try {
          this.processMessage(new Message(incomingData.slice(0, incomingData.indexOf('#'))));
        } catch (error: any) {
          Logger.trace(`Network.handleIncomingData(): ${error.toString()}`);
        }
        incomingData = incomingData.slice(incomingData.indexOf('#') + 1);
      }
    });
    socket.on('close', () => {
      socket.destroy();
      this.mapBroadcast.delete(pk);
    });
    socket.on('error', () => {
      socket.destroy();
      this.mapBroadcast.delete(pk);
    });

    this.mapBroadcast.set(pk, socket);
  }

  private async p2pNetwork() {
    const net: Array<string> = Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]).filter((pk) => {
      return !this.mapBroadcast.has(pk);
    });

    if (net.length && net.indexOf(this.publicKey) > -1) {
      net.splice(net.indexOf(this.publicKey), 1);
      net.forEach((pk) => {
        this.outbound(pk);
      });
    }

    this.timeoutP2P = setTimeout(async () => {
      await this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);
  }

  private processMessage(m: Message) {
    if (this.arrayProcessed.includes(m.ident())) {
      return;
    }
    this.arrayProcessed.push(m.ident());

    // stateless validation
    if (!this.server.getValidation().validateMessage(m)) {
      return;
    }

    // process message
    this._onMessage && this._onMessage(m);
  }

  private clean() {
    this.arrayProcessed.splice(0, Math.floor(this.arrayProcessed.length / 2));
    this.arrayBroadcasted.splice(0, Math.floor(this.arrayBroadcasted.length / 2));

    this.timeoutClean = setTimeout(() => {
      this.clean();
    }, this.server.config.network_clean_interval_ms);
  }

  getArrayBroadcast(): Array<string> {
    return [...this.mapBroadcast.keys()];
  }

  broadcast(m: Message) {
    const buf: Buffer = Buffer.from(m.pack());
    const ident = m.ident();
    const aBroadcast: Array<string> = [...this.mapBroadcast.keys()].filter((pk) => {
      return !this.arrayBroadcasted.includes(pk + ident);
    });
    aBroadcast.forEach((pk) => {
      try {
        const socket = this.mapBroadcast.get(pk);
        socket && socket.write(buf);
        this.arrayBroadcasted.push(pk + ident);
      } catch (error: any) {
        Logger.warn('Network.broadcast() Error: ' + error.toString());
      }
    });
  }
}
