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
import { Logger } from '../logger.js';
import createError from 'http-errors';
import express, { Express, NextFunction, Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import compression from 'compression';
import { Bootstrap } from './bootstrap.js';
import { Chain } from '../chain/chain.js';
import { Validation } from './validation.js';
import { Wallet } from '../chain/wallet.js';
import { Api } from './api.js';
import { Command } from '../chain/tx.js';
import { TxFactory } from './tx-factory.js';
import { TxStruct } from '../chain/tx.js';
import { Network } from './network.js';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServerTxFeed: WebSocketServer;

  private txFactory: TxFactory = {} as TxFactory;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private chain: Chain = {} as Chain;
  private validation: Validation = {} as Validation;

  constructor(config: Config) {
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
    this.app.get('/favicon.ico', (req: Request, res: Response): void => {
      res.sendStatus(204);
    });

    // init API
    Api.make(this);
    Logger.info('Api initialized');

    // catch 404 and forward to error handler
    this.app.use((req: Request, res: Response, next: NextFunction): void => {
      next(createError(404));
    });

    // error handler
    this.app.use(Server.error);

    // Web Server
    this.httpServer = http.createServer(this.app);
    this.httpServer.on('listening', (): void => {
      Logger.info(`HttpServer listening on ${this.config.ip}:${this.config.port}`);
    });
    this.httpServer.on('close', (): void => {
      Logger.info(`HttpServer closing on ${this.config.ip}:${this.config.port}`);
    });

    // standalone Websocket Server to feed block updates
    this.webSocketServerTxFeed = new WebSocketServer({
      host: this.config.ip,
      port: this.config.port_tx_feed,
      perMessageDeflate: false,
    });
    this.webSocketServerTxFeed.on('connection', (ws: WebSocket): void => {
      ws.on('error', (error: any): void => {
        Logger.warn('WebSocketServerTxFeed.error: ' + error.toString());
        ws.terminate();
      });
    });
    this.webSocketServerTxFeed.on('close', (): void => {
      Logger.info(`WebSocketServerTxFeed closing on ${this.config.ip}:${this.config.port_tx_feed}`);
    });
    this.webSocketServerTxFeed.on('listening', (): void => {
      Logger.info(`WebSocketServerTxFeed listening on ${this.config.ip}:${this.config.port_tx_feed}`);
    });
  }

  async start(): Promise<Server> {
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

    return new Promise((resolve): void => {
      this.network.once('ready', async (): Promise<void> => {
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

  async shutdown(): Promise<void> {
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
    } else {
      return Promise.resolve();
    }
  }

  getBootstrap(): Bootstrap {
    return this.bootstrap;
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  getChain(): Chain {
    return this.chain;
  }

  getValidation(): Validation {
    return this.validation;
  }

  getNetwork(): Network {
    return this.network;
  }

  getTxFactory(): TxFactory {
    return this.txFactory;
  }

  stackTx(commands: Array<Command>): boolean {
    return this.txFactory.stack(commands);
  }

  queueWebSocketFeed(tx: TxStruct): void {
    setImmediate((tx: TxStruct): void => {
      this.webSocketServerTxFeed.clients.forEach(
        (ws) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(tx))
      );
    }, tx);
  }

  private static error(err: any, req: Request, res: Response, next: NextFunction): void {
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
