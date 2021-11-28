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

import { Config, PBFT_RETRY_INTERVAL_MS } from '../config';
import { Logger } from '../logger';
import createError from 'http-errors';
import express, { Express, NextFunction, Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import compression from 'compression';
import { Bootstrap } from './bootstrap';
import { BlockStruct } from '../chain/block';
import { Blockchain } from '../chain/blockchain';
import { Validation } from './validation';
import { Pool } from './pool';
import { Wallet } from '../chain/wallet';
import { NetworkSam } from './network-sam';
import { Message } from './message/message';
import { Api } from './api';
import { ArrayCommand } from '../chain/transaction';
import { Sync } from './message/sync';
import { Lock, LockStruct } from './message/lock';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServer: WebSocket.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private pool: Pool = {} as Pool;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: NetworkSam = {} as NetworkSam;
  private blockchain: Blockchain = {} as Blockchain;
  private validation: Validation = {} as Validation;

  private stackSync: Array<BlockStruct> = [];

  private timeoutLock: NodeJS.Timeout = {} as NodeJS.Timeout;

  constructor(config: Config) {
    this.config = config;
    Logger.info(`divachain ${this.config.VERSION} instantiating...`);

    // express application
    this.app = express();
    // hide express
    this.app.set('x-powered-by', false);

    // compression
    this.app.use(compression());

    // json
    this.app.use(express.json());

    // catch unavailable favicon.ico
    this.app.get('/favicon.ico', (req: Request, res: Response) => {
      res.sendStatus(204);
    });

    // init API
    Api.make(this);
    Logger.info('Api initialized');

    // catch 404 and forward to error handler
    this.app.use((req: Request, res: Response, next: NextFunction) => {
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

    this.webSocketServer = new WebSocket.Server({
      server: this.httpServer,
      clientTracking: false,
      perMessageDeflate: false,
      skipUTF8Validation: true,
    });
    this.webSocketServer.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: Error) => {
        Logger.warn('Server webSocketServer.error: ' + JSON.stringify(error));
        ws.terminate();
      });
    });
    this.webSocketServer.on('close', () => {
      Logger.info('WebSocketServer closing');
    });

    // standalone Websocket Server to feed block updates
    this.webSocketServerBlockFeed = new WebSocket.Server({
      host: this.config.ip,
      port: this.config.port_block_feed,
    });
    this.webSocketServerBlockFeed.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: Error) => {
        Logger.warn('Server webSocketServerBlockFeed.error: ' + JSON.stringify(error));
        ws.terminate();
      });
    });
    this.webSocketServerBlockFeed.on('close', () => {
      Logger.info('WebSocketServerBlockFeed closing');
    });
  }

  async start(): Promise<void> {
    this.bootstrap = await Bootstrap.make(this);
    Logger.info(`Address ${this.config.address}`);

    Logger.trace(this.config);

    this.wallet = Wallet.make(this.config);
    Logger.info('Wallet initialized');

    this.blockchain = await Blockchain.make(this);
    Logger.info('Blockchain initialized');

    this.validation = Validation.make();
    Logger.info('Validation initialized');

    this.network = NetworkSam.make(this, (type: number, message: Buffer | string) => {
      return this.onMessage(type, message);
    });
    Logger.info('Network initialized');

    this.pool = Pool.make(this);
    Logger.info('Pool initialized');

    await this.httpServer.listen(this.config.port, this.config.ip);

    if (this.config.bootstrap) {
      await this.bootstrap.syncWithNetwork();
      if (!this.network.hasNetworkAddress(this.config.address)) {
        await this.bootstrap.enterNetwork(this.wallet.getPublicKey());
      }
    }

    if (this.blockchain.getHeight() === 0) {
      await this.blockchain.reset(Blockchain.genesis(this.config.path_genesis));
    }

    this.pool.initHeight();

    return new Promise((resolve) => {
      this.network.once('ready', resolve);
    });
  }

  async shutdown(): Promise<void> {
    this.wallet.close();
    this.network.shutdown();
    await this.blockchain.shutdown();

    if (this.webSocketServer) {
      await new Promise((resolve) => {
        this.webSocketServer.close(resolve);
      });
    }
    if (this.httpServer) {
      await new Promise((resolve) => {
        this.httpServer.close(resolve);
      });
    }
  }

  getBootstrap(): Bootstrap {
    return this.bootstrap;
  }

  getPool(): Pool {
    return this.pool;
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  getNetwork(): NetworkSam {
    return this.network;
  }

  getBlockchain(): Blockchain {
    return this.blockchain;
  }

  getValidation(): Validation {
    return this.validation;
  }

  stackTx(arrayCommand: ArrayCommand, ident: string = ''): string | false {
    const s = this.pool.stack(ident, arrayCommand);
    s && this.pool.release() && this.doLock();
    return s || false;
  }

  private doLock() {
    if (this.pool.hasTransactions()) {
      // process and distribute the lock
      this.processLock(this.pool.getLock());

      // retry
      this.timeoutLock = setTimeout(() => {
        this.doLock();
      }, PBFT_RETRY_INTERVAL_MS);
    }
  }

  private processLock(lock: Lock) {
    const l: LockStruct = lock.get();

    // process only valid locks
    // stateful
    if (!Lock.isValid(l)) {
      return;
    }

    if (!this.pool.add(l)) {
      return;
    }

    if (this.pool.hasBlock()) {
      this.network.broadcast(lock);

      //@FIXME logging
      Logger.trace(`LOCKED: ${this.pool.getBlock().height} ${this.pool.getBlock().hash}`);

      const sync = new Sync().create(this.pool.getBlock());
      this.network.broadcast(sync);
      this.processSync(sync);
    } else {
      const _lock = this.pool.getLock();
      _lock && this.network.broadcast(_lock);
    }
  }

  private processSync(sync: Sync) {
    this.stackSync = this.stackSync.concat(sync.get().block).sort((a, b) => (a.height > b.height ? 1 : -1));

    let h = this.blockchain.getHeight();
    let b: BlockStruct = (this.stackSync.shift() || {}) as BlockStruct;

    while (b.height) {
      if (b.height === h + 1) {
        this.addBlock(b);
      } else if (b.height > h + 1) {
        break;
      }

      h = this.blockchain.getHeight();
      b = (this.stackSync.shift() || {}) as BlockStruct;
    }
  }

  private addBlock(block: BlockStruct) {
    clearTimeout(this.timeoutLock);
    this.pool.clear(block);

    if (this.blockchain.add(block)) {
      //@FIXME logging
      Logger.trace(`Block added: ${block.height}`);

      setImmediate((s: string) => {
        this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(s));
      }, JSON.stringify(block));
    }

    this.pool.release() && this.doLock();
  }

  private onMessage(type: number, message: Buffer | string) {
    switch (type) {
      case Message.TYPE_LOCK:
        this.processLock(new Lock(message));
        break;
      case Message.TYPE_SYNC:
        this.processSync(new Sync(message));
        break;
      default:
        throw new Error('Invalid message type');
    }
  }

  private static error(err: any, req: Request, res: Response, next: NextFunction) {
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
