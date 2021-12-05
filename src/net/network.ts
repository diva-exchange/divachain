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
import { createDatagram, I2pSamDatagram } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import { Util } from '../chain/util';
import crypto from 'crypto';
import { Sync } from './message/sync';

export class Network extends EventEmitter {
  private readonly server: Server;
  private sam: I2pSamDatagram = {} as I2pSamDatagram;

  private readonly publicKey: string;
  private arrayBroadcast: Array<string> = [];
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

    this.init();

    this.timeoutClean = setTimeout(() => this.clean(), this.server.config.network_clean_interval_ms);
  }

  shutdown() {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutClean);

    this.sam.close();
  }

  private init() {
    let started = false;
    const i = setInterval(async () => {
      if (!started && [...this.server.getBlockchain().getMapPeer().keys()].length > 0) {
        started = true;
        Logger.info(`P2P starting on ${this.server.config.address}`);

        this.sam = (
          await createDatagram({
            sam: {
              host: this.server.config.i2p_sam_host,
              portTCP: this.server.config.i2p_sam_port_tcp,
              publicKey: this.server.config.i2p_public_key,
              privateKey: this.server.config.i2p_private_key,
            },
            listen: {
              address: '0.0.0.0',
              port: this.server.config.i2p_sam_forward_port,
              hostForward: this.server.config.i2p_sam_forward_host,
              portForward: this.server.config.i2p_sam_forward_port,
            },
          })
        ).on('data', (data: Buffer, from: string) => {
          const msg = data.toString().trim();
          if (!msg || !from) {
            return;
          }
          if (/^[\d]+$/.test(msg)) {
            // ping, including height
            if (Number(msg) < this.server.getBlockchain().getHeight()) {
              setImmediate(async () => {
                const m = new Sync().create(
                  await this.server.getBlockchain().getRange(Number(msg) + 1, this.server.getBlockchain().getHeight())
                );
                const buf: Buffer = Buffer.from(m.pack());
                this.sam.send(from, buf);
              });
            }
          } else {
            try {
              this.processMessage(new Message(msg));
            } catch (error: any) {
              Logger.trace(`Network.handleIncomingData(): ${error.toString()}`);
            }
          }
        });
        Logger.info(`Inbound SAM connection available ${this.server.config.i2p_sam_host}`);

        this.p2pNetwork();
      }

      if (started) {
        const nq = this.arrayBroadcast.reduce((q, pk) => q + this.server.getBlockchain().getStake(pk), 0);
        if (nq * 0.9 >= this.server.getBlockchain().getQuorum()) {
          Logger.info(`P2P ready on ${this.server.config.address}`);
          this.emit('ready');
          clearInterval(i);
        }
      }
    }, 2000);
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
        try {
          this.sam.send(this.server.getBlockchain().getPeer(pk).destination, buf);
        } catch (error: any) {
          Logger.warn('Network.p2pNetwork() ping error: ' + error.toString());
        }
      }, int);
      int = int + step;
    });
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
    return this.arrayBroadcast;
  }

  broadcast(m: Message) {
    const ident: string = m.ident();
    const buf: Buffer = Buffer.from(m.pack());
    this.arrayBroadcast
      .filter((pk) => {
        return !this.arrayBroadcasted.includes(pk + ident);
      })
      .forEach((pk) => {
        try {
          this.sam.send(this.server.getBlockchain().getPeer(pk).destination, buf);
          this.arrayBroadcasted.push(pk + ident);
        } catch (error: any) {
          Logger.warn('Network.broadcast() Error: ' + error.toString());
        }
      });
  }
}
