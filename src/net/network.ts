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
import { Sync } from './message/sync';

export class Network extends EventEmitter {
  private readonly server: Server;
  private samForward: I2pSamStream = {} as I2pSamStream;
  private samUDP: I2pSamDatagram = {} as I2pSamDatagram;

  private readonly publicKey: string;
  private arrayBroadcast: Array<string> = [];
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

    this.init();

    this.timeoutClean = setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  shutdown() {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutClean);

    this.samUDP.close();
  }

  private init() {
    let started = false;
    const i = setInterval(async () => {
      const _c = this.server.config;

      if (!started && [...this.server.getBlockchain().getMapPeer().keys()].length > 0) {
        started = true;
        Logger.info(`P2P starting on ${toB32(_c.udp)}.b32.i2p`);

        this.samForward = await createForward({
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
        });
        Logger.info(
          `SAM HTTP ${toB32(_c.http)}.b32.i2p forwarded to ${_c.i2p_sam_forward_http_host}:${
            _c.i2p_sam_forward_http_port
          }`
        );

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
            Logger.warn('SAM Error: ' + error.toString());
          });
        Logger.info(
          `SAM UDP ${toB32(_c.udp)}.b32.i2p forwarded to ${_c.i2p_sam_forward_udp_host}:${_c.i2p_sam_forward_udp_port}`
        );

        this.p2pNetwork();
      }

      if (started) {
        const nq =
          this.server.getBlockchain().getStake(this.publicKey) +
          this.arrayBroadcast.reduce((q, pk) => q + this.server.getBlockchain().getStake(pk), 0);
        if (nq >= this.server.getBlockchain().getQuorum()) {
          Logger.info(`P2P ready on ${toB32(_c.udp)}.b32.i2p`);
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
      if (Number(msg) < this.server.getBlockchain().getHeight()) {
        setImmediate(async () => {
          const m = new Sync().create(
            await this.server.getBlockchain().getRange(Number(msg) + 1, this.server.getBlockchain().getHeight())
          );
          const buf: Buffer = Buffer.from(m.pack());
          this.samUDP.send(from, buf);
        });
      }
    } else {
      try {
        this.processMessage(new Message(msg));
      } catch (error: any) {
        Logger.trace(`Network.incomingData(): ${error.toString()}`);
      }
    }
  }

  private p2pNetwork() {
    this.timeoutP2P = setTimeout(async () => {
      this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);

    this.arrayBroadcast = Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]).filter((pk) => {
      return pk !== this.publicKey;
    });

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

    // process message
    this._onMessage && this._onMessage(m);
  }

  private clean() {
    this.arrayBroadcasted.splice(0, Math.floor(this.arrayBroadcasted.length / 2));

    this.timeoutClean = setTimeout(() => {
      this.clean();
    }, this.server.config.network_clean_interval_ms);
  }

  getArrayBroadcast(): Array<string> {
    return this.arrayBroadcast;
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
}
