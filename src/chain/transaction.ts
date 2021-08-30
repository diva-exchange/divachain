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

import { Wallet } from './wallet';
import { nanoid } from 'nanoid';

const MAX_LENGTH_IDENT = 32;

interface Command {
  seq: number;
  cmd: string;
}

interface CommandData extends Command {
  b64u: string;
}

export interface CommandAddPeer extends Command {
  host: string;
  port: number;
  pk: string;
}

export interface CommandRemovePeer extends Command {
  pk: string;
}

export interface CommandModifyStake extends Command {
  pk: string;
  stk: number;
}

export type ArrayCommand = Array<CommandAddPeer | CommandRemovePeer | CommandModifyStake | CommandData>;

export type TransactionStruct = {
  ident: string;
  orgn: string;
  ts: number; // Format: Milliseconds (1/1,000 second)
  cmds: ArrayCommand;
  sig: string;
};

export class Transaction {
  private readonly structTransaction: TransactionStruct;

  constructor(wallet: Wallet, commands: ArrayCommand, ident: string = '') {
    const _ident = ident.length > 0 && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(8);
    const _ts = Date.now();
    this.structTransaction = {
      ident: _ident,
      orgn: wallet.getPublicKey(),
      ts: _ts,
      cmds: commands,
      sig: wallet.sign(_ident + _ts + JSON.stringify(commands)),
    };
  }

  get(): TransactionStruct {
    return this.structTransaction;
  }
}
