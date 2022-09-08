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

import { Wallet } from './wallet';

interface Command {
  seq: number;
  command: string;
}

export interface CommandAddPeer extends Command {
  http: string;
  udp: string;
  publicKey: string;
}

export interface CommandRemovePeer extends Command {
  publicKey: string;
}

export interface CommandModifyStake extends Command {
  publicKey: string;
  stake: number;
}

export interface CommandData extends Command {
  ns: string;
  d: string;
}

export interface CommandDecision extends Command {
  ns: string;
  h: number;
  d: string;
}

export type ArrayCommand = Array<
  CommandAddPeer | CommandRemovePeer | CommandModifyStake | CommandData | CommandDecision
>;

export type TransactionStruct = {
  ident: string;
  origin: string;
  commands: ArrayCommand;
  sig: string;
};

export class Transaction {
  private readonly structTransaction: TransactionStruct;

  constructor(wallet: Wallet, height: number, ident: string, commands: ArrayCommand) {
    this.structTransaction = {
      ident: ident,
      origin: wallet.getPublicKey(),
      commands: commands,
      sig: wallet.sign(height + JSON.stringify(commands)),
    };
  }

  get(): TransactionStruct {
    return this.structTransaction;
  }
}
