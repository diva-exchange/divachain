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

import { base64url } from 'rfc4648';
import { nanoid } from 'nanoid';
import zlib from 'zlib';

const DEFAULT_NANOID_LENGTH = 10;

export type MessageStruct = {
  ident: string;
  seq: number;
  origin: string;
  dest: string;
  sig: string;
  data: any;
};

export class Message {
  static readonly VERSION_2 = 2; // base64url encoded object data
  static readonly VERSION_3 = 3; // base64url encoded, zlib compressed object data

  static readonly VERSION = Message.VERSION_3;

  static readonly TYPE_ADD_TX = 1;
  static readonly TYPE_PROPOSE_BLOCK = 2;
  static readonly TYPE_SIGN_BLOCK = 3;
  static readonly TYPE_CONFIRM_BLOCK = 4;
  static readonly TYPE_SYNC = 5;

  protected message: MessageStruct = {} as MessageStruct;

  constructor(message?: Buffer | string) {
    if (message) {
      this._unpack(message);
    }
  }

  protected init(origin: string, dest: string = '') {
    this.message.seq = Date.now();
    this.message.origin = origin;
    this.message.dest = dest;
  }

  getMessage(): MessageStruct {
    return this.message;
  }

  type(): number {
    return this.message.data.type;
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

  sig(): string {
    return this.message.sig;
  }

  pack(version?: number): string {
    this.message.ident = this.message.ident || [this.message.data.type, nanoid(DEFAULT_NANOID_LENGTH)].join();
    return this._pack(version);
  }

  protected _pack(version: number = Message.VERSION): string {
    switch (version) {
      case Message.VERSION_2:
        return version + ';' + base64url.stringify(Buffer.from(JSON.stringify(this.message))) + '\n';
      case Message.VERSION_3:
        return version + ';' + base64url.stringify(zlib.deflateRawSync(JSON.stringify(this.message))) + '\n';
    }
    throw new Error('Message.pack(): unsupported data version');
  }

  protected _unpack(input: Buffer | string): void {
    let version: number = 0;
    let message: string = '';
    const m = input
      .toString()
      .trim()
      .match(/^([0-9]+);(.+)$/);
    if (m && m.length === 3) {
      version = Number(m[1]);
      message = m[2];
    }

    switch (version) {
      case Message.VERSION_2:
        this.message = JSON.parse(base64url.parse(message).toString());
        break;
      case Message.VERSION_3:
        this.message = JSON.parse(zlib.inflateRawSync(base64url.parse(message)).toString());
        break;
      default:
        throw new Error(`Message.unpack(): unsupported data version ${version}`);
    }
  }
}
