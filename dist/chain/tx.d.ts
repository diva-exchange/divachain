/**
 * Copyright (C) 2024 diva.exchange
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
import { Wallet } from './wallet.js';
interface Cmd {
    command: string;
}
export interface CommandAddPeer extends Cmd {
    http: string;
    tcp: string;
    udp: string;
    publicKey: string;
}
export interface CommandRemovePeer extends Cmd {
    publicKey: string;
}
export interface CommandModifyStake extends Cmd {
    publicKey: string;
    ident: string;
    stake: number;
}
export interface CommandData extends Cmd {
    ns: string;
    d: string;
}
export type Command = CommandAddPeer | CommandRemovePeer | CommandModifyStake | CommandData;
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
export declare class Tx {
    private readonly prevTx;
    private readonly v;
    private readonly height;
    private readonly origin;
    private readonly prev;
    private readonly hash;
    private readonly commands;
    private readonly votes;
    constructor(wallet: Wallet, prevTx: TxStruct, commands: Array<Command>);
    get(): TxStruct;
}
export {};
