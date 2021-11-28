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

import base64url from 'base64url';
import { nanoid } from 'nanoid';
import * as zlib from 'zlib';

export type MessageStruct = {
  ident: string;
  data: any;
};

export class Message {
  static readonly VERSION_1 = 1; // string representation of object data
  static readonly VERSION_2 = 2; // base64url encoded object data
  static readonly VERSION_3 = 3; // base64url encoded, zlib compressed object data

  static readonly VERSION = Message.VERSION_2;

  static readonly TYPE_CHALLENGE = 1;
  static readonly TYPE_AUTH = 2;
  static readonly TYPE_LOCK = 3;
  static readonly TYPE_SYNC = 4;

  protected message: MessageStruct = {} as MessageStruct;

  constructor(message?: Buffer | string) {
    if (message) {
      this._unpack(message);
    }
  }

  getMessage(): MessageStruct {
    return this.message;
  }

  ident(): string {
    return this.message.ident;
  }

  type(): number {
    return this.message.data.type;
  }

  origin(): string {
    return this.message.data.origin || '';
  }

  sig(): string {
    return this.message.data.sig || '';
  }

  hash(): string {
    return this.message.data.block ? this.message.data.block.hash : '';
  }

  pack(version?: number): string {
    this.message.ident = this.message.ident || [this.message.data.type, nanoid(16)].join();
    return this._pack(version);
  }

  protected _pack(version: number = Message.VERSION): string {
    switch (version) {
      case Message.VERSION_1:
        return version + ';' + JSON.stringify(this.message);
      case Message.VERSION_2:
        return version + ';' + base64url.encode(JSON.stringify(this.message));
      case Message.VERSION_3:
        return (
          version + ';' + base64url.encode(zlib.deflateRawSync(Buffer.from(JSON.stringify(this.message), 'binary')))
        );
    }
    throw new Error('Message.pack(): unsupported data version');
  }

  protected _unpack(input: Buffer | string): void {
    let version: number = 0;
    let message: string = '';
    const m = input.toString().match(/^([0-9]+);(.+)$/);
    if (m && m.length > 2) {
      version = Number(m[1]);
      message = m[2];
    }

    switch (version) {
      case Message.VERSION_1:
        this.message = JSON.parse(message);
        break;
      case Message.VERSION_2:
        this.message = JSON.parse(base64url.decode(message));
        break;
      case Message.VERSION_3:
        this.message = JSON.parse(zlib.inflateRawSync(base64url.decode(message)).toString('binary'));
        break;
      default:
        throw new Error(`Message.unpack(): unsupported data version ${version}`);
    }
  }
}
