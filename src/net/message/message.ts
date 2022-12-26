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

 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { base64url } from 'rfc4648';
import zlib from 'zlib';
import { Util } from '../../chain/util';
import { Wallet } from '../../chain/wallet';
import { Logger } from '../../logger';

export type MessageStruct = {
  seq: number;
  origin: string;
  dest: string;
  data: any;
};

export class Message {
  static readonly VERSION_4 = 4; // base64url encoded, zlib compressed object data, signed

  static readonly VERSION = Message.VERSION_4;

  static readonly TYPE_ADD_TX = 1;
  static readonly TYPE_PROPOSE_BLOCK = 2;
  static readonly TYPE_SIGN_BLOCK = 3;
  static readonly TYPE_CONFIRM_BLOCK = 4;
  static readonly TYPE_STATUS = 5;

  private msg: Buffer;
  protected message: MessageStruct = {} as MessageStruct;

  constructor(msg?: Buffer) {
    this.msg = msg || Buffer.from('');
    if (this.msg.length > 0) {
      this.unpack();
    }
  }

  protected init(origin: string, dest: string = '') {
    this.message.seq = Date.now();
    this.message.origin = origin;
    this.message.dest = dest;
  }

  asBuffer(): Buffer {
    return this.msg;
  }

  getMessage(): MessageStruct {
    return this.message;
  }

  type(): number {
    return this.message.data.type || 0;
  }

  seq(): number {
    return this.message.seq;
  }

  origin(): string {
    return this.message.origin;
  }

  dest(): string {
    return this.message.dest;
  }

  pack(wallet: Wallet, version: number = Message.VERSION): Buffer {
    const s: string = base64url.stringify(zlib.deflateRawSync(JSON.stringify(this.message)));
    switch (version) {
      case Message.VERSION_4:
        this.msg = Buffer.from(version + ';' + s + ';' + wallet.sign(s) + '\n');
        return this.msg;
      default:
        throw new Error('Message.pack(): unsupported data version');
    }
  }

  private unpack(): void {
    let version: number = 0;
    let message: string = '';
    let sig: string = '';
    const m = this.msg
      .toString()
      .trim()
      .match(/^([0-9]+);([^;]+);([A-Za-z0-9_-]{86})$/);
    if (m && m.length === 4) {
      version = Number(m[1]);
      message = m[2];
      sig = m[3];
    }

    switch (version) {
      case Message.VERSION_4:
        try {
          this.message = JSON.parse(zlib.inflateRawSync(base64url.parse(message)).toString());
          if (!this.message.origin || !Util.verifySignature(this.message.origin, sig, message)) {
            this.message = {} as MessageStruct;
          }
        } catch (error: any) {
          this.message = {} as MessageStruct;
        }
        break;
      default:
        Logger.warn(`Message.unpack(): unsupported version ${version}, length: ${this.msg.length}`);
        Logger.trace(this.msg.toString());
    }
  }
}
