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
import { Server } from './server.js';
export declare class Api {
    private package;
    private server;
    static make(server: Server): Api;
    private constructor();
    private route;
    private join;
    private leave;
    private challenge;
    private sync;
    private about;
    private network;
    private broadcast;
    private status;
    private stateSearch;
    private state;
    private getStack;
    private getGenesis;
    private getLatest;
    private getTx;
    private search;
    private getPage;
    private txs;
    private putTransaction;
    private isStringPublicKey;
}
