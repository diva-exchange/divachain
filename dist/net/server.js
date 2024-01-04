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
import { Logger } from '../logger.js';
import createError from 'http-errors';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import compression from 'compression';
import { Bootstrap } from './bootstrap.js';
import { Chain } from '../chain/chain.js';
import { Validation } from './validation.js';
import { Wallet } from '../chain/wallet.js';
import { Api } from './api.js';
import { TxFactory } from './tx-factory.js';
import { Network } from './network.js';
export class Server {
    config;
    app;
    httpServer;
    webSocketServerTxFeed;
    txFactory = {};
    bootstrap = {};
    wallet = {};
    network = {};
    chain = {};
    validation = {};
    constructor(config) {
        this.config = config;
        Logger.info(`divachain ${this.config.VERSION} instantiating...`);
        this.config.is_testnet && Logger.warn('IMPORTANT: this is a test node (API is NOT protected)');
        // express application
        this.app = express();
        // hide express
        this.app.set('x-powered-by', false);
        // compression
        this.app.use(compression());
        // json
        this.app.use(express.json());
        // catch unavailable favicon.ico
        this.app.get('/favicon.ico', (req, res) => {
            res.sendStatus(204);
        });
        // init API
        Api.make(this);
        Logger.info('Api initialized');
        // catch 404 and forward to error handler
        this.app.use((req, res, next) => {
            next(createError(404));
        });
        // error handler
        this.app.use(Server.error);
        // Web Server
        this.httpServer = http.createServer(this.app);
        this.httpServer.on('listening', () => {
            Logger.info(`HttpServer listening on ${this.config.ip}:${this.config.port}`);
        });
        this.httpServer.on('close', () => {
            Logger.info(`HttpServer closing on ${this.config.ip}:${this.config.port}`);
        });
        // standalone Websocket Server to feed block updates
        this.webSocketServerTxFeed = new WebSocketServer({
            host: this.config.ip,
            port: this.config.port_tx_feed,
            perMessageDeflate: false,
        });
        this.webSocketServerTxFeed.on('connection', (ws) => {
            ws.on('error', (error) => {
                Logger.warn('WebSocketServerTxFeed.error: ' + error.toString());
                ws.terminate();
            });
        });
        this.webSocketServerTxFeed.on('close', () => {
            Logger.info(`WebSocketServerTxFeed closing on ${this.config.ip}:${this.config.port_tx_feed}`);
        });
        this.webSocketServerTxFeed.on('listening', () => {
            Logger.info(`WebSocketServerTxFeed listening on ${this.config.ip}:${this.config.port_tx_feed}`);
        });
    }
    async start() {
        Logger.info(`HTTP endpoint ${this.config.http}`);
        Logger.info(`UDP endpoint ${this.config.udp}`);
        this.wallet = Wallet.make(this.config);
        Logger.info('Wallet initialized');
        this.chain = await Chain.make(this);
        Logger.info('Chain initialized');
        this.validation = Validation.make();
        Logger.info('Validation initialized');
        this.network = Network.make(this);
        this.txFactory = TxFactory.make(this);
        Logger.info('TxFactory initialized');
        this.httpServer.listen(this.config.port, this.config.ip);
        return new Promise((resolve) => {
            this.network.once('ready', async () => {
                this.bootstrap = Bootstrap.make(this);
                if (this.config.bootstrap) {
                    // bootstrapping (entering the network)
                    await this.bootstrap.syncWithNetwork();
                    if (!this.chain.hasNetworkHttp(this.config.http)) {
                        await this.bootstrap.joinNetwork(this.wallet.getPublicKey());
                    }
                }
                resolve(this);
            });
        });
    }
    async shutdown() {
        typeof this.txFactory.shutdown === 'function' && this.txFactory.shutdown();
        typeof this.network.shutdown === 'function' && this.network.shutdown();
        typeof this.wallet.close === 'function' && this.wallet.close();
        typeof this.chain.shutdown === 'function' && (await this.chain.shutdown());
        if (typeof this.httpServer.close === 'function') {
            return await new Promise((resolve) => {
                this.httpServer.close(() => {
                    resolve();
                });
            });
        }
        else {
            return Promise.resolve();
        }
    }
    getBootstrap() {
        return this.bootstrap;
    }
    getWallet() {
        return this.wallet;
    }
    getChain() {
        return this.chain;
    }
    getValidation() {
        return this.validation;
    }
    getNetwork() {
        return this.network;
    }
    getTxFactory() {
        return this.txFactory;
    }
    stackTx(commands) {
        return this.txFactory.stack(commands);
    }
    queueWebSocketFeed(tx) {
        setImmediate((tx) => {
            this.webSocketServerTxFeed.clients.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(tx)));
        }, tx);
    }
    static error(err, req, res, next) {
        res.status(err.status || 500);
        res.json({
            path: req.path,
            status: err.status || 500,
            message: err.message,
            error: process.env.NODE_ENV === 'development' ? err : {},
        });
        next();
    }
}
//# sourceMappingURL=server.js.map