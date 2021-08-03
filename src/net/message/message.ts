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

import base64url from 'base64-url';
import { nanoid } from 'nanoid';

export type MessageStruct = {
  ident: string;
  type: number;
  data: any;
  broadcast: boolean;
  trail: Array<string>;
};

export class Message {
  static readonly VERSION_1 = 1; // string representation of object data
  static readonly VERSION_2 = 2; // base64url encoded object data

  static readonly VERSION = Message.VERSION_2;

  static readonly TYPE_CHALLENGE = 1;
  static readonly TYPE_AUTH = 2;
  static readonly TYPE_VOTE = 3;
  static readonly TYPE_COMMIT = 4;
  static readonly TYPE_SYNC = 5;

  protected message: MessageStruct = {} as MessageStruct;

  /**
   * @param {Buffer|string} message
   * @throws {Error}
   */
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
    return this.message.type;
  }

  isBroadcast(): boolean {
    return this.message.broadcast;
  }

  trail(): Array<string> {
    return this.message.trail || [];
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

  updateTrail(arrayTrail: Array<string>) {
    if (!arrayTrail.length) {
      return;
    } else if (!this.message.trail) {
      this.message.trail = [];
    }
    arrayTrail.forEach((_pk) => _pk && !this.message.trail.includes(_pk) && this.message.trail.push(_pk));
  }

  /**
   * @param {number} version
   * @return {string}
   * @throws {Error}
   */
  pack(version?: number): string {
    this.message.ident = this.message.ident || this.message.type + nanoid(16);
    this.message.broadcast = this.message.broadcast || false;
    return this._pack(version);
  }

  protected _pack(version: number = Message.VERSION): string {
    switch (version) {
      case Message.VERSION_1:
        return version + ';' + JSON.stringify(this.message);
      case Message.VERSION_2:
        return version + ';' + base64url.encode(JSON.stringify(this.message));
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
      default:
        throw new Error(`Message.unpack(): unsupported data version ${version}`);
    }
  }
}
