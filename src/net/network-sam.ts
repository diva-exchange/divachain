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
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Util } from '../chain/util';
import { Server } from './server';
import Timeout = NodeJS.Timeout;
import { createDatagram, I2pSamRaw } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import EventEmitter from 'events';
import { MAX_NETWORK_PING_INTERVAL_MS, MIN_NETWORK_PING_INTERVAL_MS } from '../config';
import { Sync } from './message/sync';

export class NetworkSam extends EventEmitter {
  private readonly server: Server;
  private readonly socksProxyAgent: SocksProxyAgent | undefined;

  private readonly publicKey: string;

  private sam: I2pSamRaw = {} as I2pSamRaw;

  private arrayBroadcast: Array<string> = [];

  private arrayProcessed: Array<string> = [];

  private readonly _onMessage: Function | false;

  private timeoutPing: Timeout = {} as Timeout;
  private timeoutMorph: Timeout = {} as Timeout;

  static make(server: Server, onMessage: Function): NetworkSam {
    return new NetworkSam(server, onMessage);
  }

  private constructor(server: Server, onMessage: Function) {
    super();

    this.server = server;
    const config = this.server.config;

    this.socksProxyAgent = config.i2p_has_socks
      ? new SocksProxyAgent(`socks://${config.i2p_socks_host}:${config.i2p_socks_port}`)
      : undefined;
    this._onMessage = onMessage || false;

    this.publicKey = this.server.getWallet().getPublicKey();
    Logger.info(`Network, public key: ${this.publicKey}`);

    let started = false;
    const i = setInterval(() => {
      if (!started && [...this.server.getBlockchain().getMapPeer().keys()].length > 0) {
        Logger.info(`P2P starting on ${this.server.config.address}`);
        started = true;
        this.timeoutMorph = setTimeout(async () => {
          this.sam = await createDatagram({
            sam: {
              host: config.i2p_sam_host,
              portTCP: config.i2p_sam_port_tcp,
              portUDP: config.i2p_sam_port_udp,
              publicKey: config.i2p_public_key,
              privateKey: config.i2p_private_key,
            },
            listen: {
              address: config.i2p_sam_listen_address,
              port: config.i2p_sam_listen_port,
              hostForward: config.i2p_sam_listen_forward_host,
              portForward: config.i2p_sam_listen_forward_port,
              onMessage: async (b: Buffer, fromDestination: string) => {
                if (this.hasNetworkDestination(fromDestination) && this.arrayBroadcast.length > 0) {
                  if (/^[\d]+$/.test(b.toString())) {
                    const height = Number(b.toString());
                    if (height < this.server.getBlockchain().getHeight()) {
                      //@FIXME logging
                      console.debug(`syncing: ${height + 1}`);
                      const m = new Sync().create(
                        (await this.server.getBlockchain().getRange(height + 1, height + 1))[0]
                      );
                      this.broadcast(m);
                    }
                  } else {
                    this.processMessage(b);
                  }
                }
              },
            },
          });
          Logger.info(`SAM connection established ${config.i2p_sam_host}`);

          this.morphPeerNetwork();
          this.ping();
        }, 1);
      }

      if (this.arrayBroadcast.length > config.network_size / 2) {
        Logger.info(`P2P ready on ${this.server.config.address}`);
        this.emit('ready');
        clearInterval(i);
      }
    }, 250);
  }

  shutdown() {
    clearTimeout(this.timeoutPing);
    clearTimeout(this.timeoutMorph);

    this.emit('close');
  }

  network() {
    return {
      network: [...this.server.getBlockchain().getMapPeer()].map((v) => {
        return { publicKey: v[0], address: v[1].address, destination: v[1].destination, stake: v[1].stake };
      }),
      broadcast: this.arrayBroadcast,
    };
  }

  hasNetworkPeer(publicKey: string): boolean {
    return this.server.getBlockchain().getMapPeer().has(publicKey);
  }

  hasNetworkAddress(address: string): boolean {
    for (const v of [...this.server.getBlockchain().getMapPeer()]) {
      if (v[1].address === address) {
        return true;
      }
    }
    return false;
  }

  hasNetworkDestination(destination: string): boolean {
    for (const v of [...this.server.getBlockchain().getMapPeer()]) {
      if (v[1].destination === destination) {
        return true;
      }
    }
    return false;
  }

  processMessage(message: Buffer | string) {
    const m: Message = new Message(message);
    if (this.server.config.network_verbose_logging) {
      const _l = `-> ${this.server.getWallet().getPublicKey()}:`;
      Logger.trace(`${_l} ${m.type()} - ${m.ident()}`);
    }

    if (this.arrayProcessed.includes(m.ident())) {
      return;
    }

    // stateless validation
    if (!this.server.getValidation().validateMessage(m)) {
      return;
    }

    // process message
    this._onMessage && this._onMessage(m.type(), message);
    this.arrayProcessed.push(m.ident());
  }

  broadcast(m: Message) {
    for (const _pk of this.arrayBroadcast) {
      try {
        this.sam.send(this.server.getBlockchain().getPeer(_pk).destination, Buffer.from(m.pack()));
      } catch (error: any) {
        Logger.warn('Network.processMessage() broadcast Error: ' + error.toString());
      }
    }
  }

  private morphPeerNetwork() {
    const net: Array<string> = Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]);
    if (net.length && net.indexOf(this.publicKey) > -1) {
      net.splice(net.indexOf(this.publicKey), 1);
      let t = Math.ceil(this.server.config.network_size * 0.2); // replace max 20% of the network
      for (const pk of net) {
        this.arrayBroadcast.indexOf(pk) < 0 && this.arrayBroadcast.push(pk);
        if (this.arrayBroadcast.length > this.server.config.network_size) {
          this.arrayBroadcast.shift();
          if (t-- <= 0) {
            break;
          }
        }
      }
    }

    this.timeoutMorph = setTimeout(() => {
      this.morphPeerNetwork();
    }, this.server.config.network_morph_interval_ms);
  }

  private ping() {
    const net: Array<string> = Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]);
    const buf: Buffer = Buffer.from(this.server.getBlockchain().getHeight().toString());
    let t = 0;
    for (const pk of net) {
      setTimeout(() => {
        try {
          this.sam.send(this.server.getBlockchain().getPeer(pk).destination, buf);
        } catch (error: any) {
          Logger.warn('Network.ping() broadcast Error: ' + error.toString());
        }
      }, Math.ceil(Math.random() * MIN_NETWORK_PING_INTERVAL_MS));
      if (t++ >= this.server.config.network_size) {
        break;
      }
    }

    this.timeoutPing = setTimeout(() => {
      this.ping();
    }, Math.ceil(Math.random() * MAX_NETWORK_PING_INTERVAL_MS) + MIN_NETWORK_PING_INTERVAL_MS);
  }

  /*
  private async sync(destination: string, height: number) {
    try {
      const m = new Sync().create((await this.server.getBlockchain().getRange(height, height))[0]);
      this.sam.send(destination, Buffer.from(m.pack()));
    } catch (error) {
      Logger.trace('Network.sync() Error' + JSON.stringify(error));
    }
  }
*/
}
