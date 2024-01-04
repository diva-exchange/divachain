/**
 * Copyright (C) 2021-2024 diva.exchange
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
import { Config } from '../config.js';
import { Express } from 'express';
import { Bootstrap } from './bootstrap.js';
import { Chain } from '../chain/chain.js';
import { Validation } from './validation.js';
import { Wallet } from '../chain/wallet.js';
import { Command } from '../chain/tx.js';
import { TxFactory } from './tx-factory.js';
import { TxStruct } from '../chain/tx.js';
import { Network } from './network.js';
export declare class Server {
    readonly config: Config;
    readonly app: Express;
    private readonly httpServer;
    private readonly webSocketServerTxFeed;
    private txFactory;
    private bootstrap;
    private wallet;
    private network;
    private chain;
    private validation;
    constructor(config: Config);
    start(): Promise<Server>;
    shutdown(): Promise<void>;
    getBootstrap(): Bootstrap;
    getWallet(): Wallet;
    getChain(): Chain;
    getValidation(): Validation;
    getNetwork(): Network;
    getTxFactory(): TxFactory;
    stackTx(commands: Array<Command>): boolean;
    queueWebSocketFeed(tx: TxStruct): void;
    private static error;
}
