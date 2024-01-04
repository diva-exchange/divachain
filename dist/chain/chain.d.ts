/**
 * Copyright (C) 2022-2024 diva.exchange
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
import { TxStruct } from './tx.js';
import { Server } from '../net/server.js';
export type Peer = {
    publicKey: string;
    http: string;
    tcp: string;
    udp: string;
    stake: number;
};
export declare class Chain {
    static readonly COMMAND_ADD_PEER: string;
    static readonly COMMAND_REMOVE_PEER: string;
    static readonly COMMAND_MODIFY_STAKE: string;
    static readonly COMMAND_DATA: string;
    private readonly server;
    private readonly publicKey;
    private readonly mapDbChain;
    private readonly dbState;
    private readonly dbPeer;
    private mapHeight;
    private mapTxs;
    private mapLatestTx;
    private mapLock;
    private mapPeer;
    private mapHttp;
    private mapTcp;
    private mapUdp;
    private countNodes;
    private stakeNodes;
    static make(server: Server): Promise<Chain>;
    private constructor();
    private init;
    private reset;
    shutdown(): Promise<void>;
    private clear;
    add(tx: TxStruct): Promise<void>;
    private updateCache;
    getRange(gte: number, lte: number, origin: string): Promise<Array<TxStruct> | undefined>;
    getPage(page: number, size: number, origin: string): Promise<Array<TxStruct> | undefined>;
    search(q: string, origin: string): Promise<Array<TxStruct> | undefined>;
    getTx(height: number, origin: string): Promise<TxStruct | undefined>;
    getState(key: string): Promise<{
        key: string;
        value: string;
    } | false>;
    searchState(search?: string): Promise<Array<{
        key: string;
        value: any;
    }>>;
    getLatestTx(origin: string): TxStruct | undefined;
    getHeight(origin: string): number | undefined;
    hasQuorum(size: number): boolean;
    getMapPeer(): Map<string, Peer>;
    getListPeer(): Array<string>;
    hasPeer(publicKey: string): boolean;
    getPeer(publicKey: string): Peer;
    hasNetworkHttp(http: string): boolean;
    getPerformance(height: number): Promise<{
        timestamp: number;
    }>;
    static genesis(p: string): TxStruct;
    private processState;
    private addPeer;
    private removePeer;
    private updateStateData;
}
