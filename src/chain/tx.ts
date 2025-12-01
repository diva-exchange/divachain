/**
 * Copyright (C) 2024-2025 diva.exchange
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

export const COMMAND_ADD_PEER: string = 'addPeer';
export type CommandAddPeer = {
  command: string;
  http: string;
  tcp: string;
  udp: string;
  publicKey: string;
};

export const COMMAND_REMOVE_PEER: string = 'removePeer';
export type CommandRemovePeer = {
  command: string;
  publicKey: string;
};

export const COMMAND_MODIFY_STAKE: string = 'modifyStake';
export type CommandModifyStake = {
  command: string;
  publicKey: string;
  ident: string;
  stake: number;
};

export const COMMAND_DATA: string = 'data';
export type CommandData = {
  command: string;
  ns: string;
  d: string;
};

export type Command =
  | CommandAddPeer
  | CommandRemovePeer
  | CommandModifyStake
  | CommandData;

export type VoteStruct = {
  origin: string;
  sig: string;
};

export type TxStruct = {
  v: number;
  height: number;
  origin: string;
  hash: string;
  prev: string;
  commands: Array<Command>;
  votes: Array<VoteStruct>;
};

export class Tx {
  private readonly prevTx: TxStruct;
  private readonly v: number;
  private readonly height: number;
  private readonly origin: string;
  private readonly prev: string;
  private readonly hash: string;
  private readonly commands: Array<Command>;
  private readonly votes: Array<VoteStruct>;

  constructor(wallet: Wallet, prevTx: TxStruct, commands: Array<Command>) {
    this.prevTx = prevTx;
    this.v = TX_VERSION;
    this.height = prevTx.height + 1;
    this.origin = wallet.getPublicKey();
    this.prev = prevTx.hash;
    this.commands = commands;
    this.hash = Util.hash({
      v: TX_VERSION,
      height: prevTx.height + 1,
      origin: wallet.getPublicKey(),
      prev: prevTx.hash,
      hash: '',
      commands: commands,
      votes: [],
    });
    this.votes = [{ origin: this.origin, sig: wallet.sign(this.hash) }];
  }

  get(): TxStruct {
    return {
      v: this.v,
      height: this.height,
      origin: this.origin,
      prev: this.prev,
      hash: this.hash,
      commands: this.commands,
      votes: this.votes,
    };
  }
}
