/**
 * Copyright (C) 2023-2024 diva.exchange
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
/// <reference types="node" resolution-mode="require"/>
import EventEmitter from 'events';
import { Server } from './server.js';
import { Peer } from '../chain/chain.js';
export declare class Network extends EventEmitter {
    private readonly server;
    private readonly publicKey;
    private readonly agent;
    private samHttpForward;
    private samUdp;
    private arrayNetwork;
    private arrayBroadcast;
    private arrayIn;
    private arrayMsgUid;
    private mapMsgParts;
    private mapMsg;
    private arrayProcessedMsgUid;
    private isClosing;
    private timeoutP2P;
    private timeoutStatus;
    static make(server: Server): Network;
    private constructor();
    shutdown(): void;
    private init;
    private initHttp;
    private initUdp;
    private onUdpData;
    private handleIncoming;
    private hasP2PNetwork;
    private p2pNetwork;
    broadcast(data: string, to?: string): void;
    private split;
    getArrayNetwork(): Array<Peer>;
    fetchFromApi(endpoint: string, timeout?: number): Promise<any>;
    private fetch;
    private bootstrapNetwork;
    private isMsgValid;
}
