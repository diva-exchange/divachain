/**
 * Copyright (C) 2024-2026 diva.exchange
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

import { Wallet } from './wallet.ts';
import { TX_VERSION } from '../config.ts';
import { Util } from './util.ts';

export const COMMAND_DATA: string = 'data';
export type CommandData = {
  c: string;
  ns: string;
  d: string;
};

export type Command = CommandData;

export type TxStruct = {
  v: number;
  h: number;
  o: string;
  ha: string;
  p: string;
  cs: Array<Command>;
};

export class Tx {
  private readonly prevTx: TxStruct;
  private readonly v: number;
  private readonly h: number;
  private readonly origin: string;
  private readonly prevHash: string;
  private readonly hash: string;
  private readonly cs: Array<Command>;

  constructor(wallet: Wallet, prevTx: TxStruct, cs: Array<Command>) {
    this.prevTx = prevTx;
    this.v = TX_VERSION;
    this.h = prevTx.h + 1;
    this.origin = wallet.getPublicKey();
    this.prevHash = prevTx.ha;
    this.cs = cs;
    this.hash = Util.hash({
      v: TX_VERSION,
      h: this.h,
      o: wallet.getPublicKey(),
      ha: '',
      p: this.prevHash,
      cs: cs,
    });
  }

  get(): TxStruct {
    return {
      v: this.v,
      h: this.h,
      o: this.origin,
      ha: this.hash,
      p: this.prevHash,
      cs: this.cs,
    };
  }
}
