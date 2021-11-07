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

import { Config } from '../config';
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
import { Network } from './network';
import { Message } from './message/message';
import { Api } from './api';
import { ArrayCommand } from '../chain/transaction';
import { Sync } from './message/sync';
import { TxProposalStruct, TxProposal } from './message/tx-proposal';
import { Vote, VoteStruct } from './message/vote';
import { Lock } from './message/lock';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServer: WebSocket.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private pool: Pool = {} as Pool;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;
  private validation: Validation = {} as Validation;

  private stackSync: Array<BlockStruct> = [];

  private timeoutRelease: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutLock: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutVote: NodeJS.Timeout = {} as NodeJS.Timeout;

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

  async start(): Promise<Server> {
    this.bootstrap = await Bootstrap.make(this);
    Logger.info(`Address ${this.config.address}`);

    Logger.trace(this.config);

    this.wallet = Wallet.make(this.config);
    Logger.info('Wallet initialized');

    this.network = Network.make(this, (type: number, message: Buffer | string) => {
      return this.onMessage(type, message);
    });
    Logger.info('Network initialized');

    this.blockchain = await Blockchain.make(this);
    Logger.info('Blockchain initialized');

    this.validation = Validation.make();
    Logger.info('Validation initialized');

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

    this.pool = Pool.make(this);
    Logger.info('Pool initialized');

    return this;
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

  getWebSocketServer(): WebSocket.Server {
    return this.webSocketServer;
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

  getNetwork(): Network {
    return this.network;
  }

  getBlockchain(): Blockchain {
    return this.blockchain;
  }

  getValidation(): Validation {
    return this.validation;
  }

  stackTxProposal(arrayCommand: ArrayCommand, ident: string = ''): string | false {
    clearTimeout(this.timeoutRelease);
    this.timeoutRelease = setTimeout(() => {
      this.doReleaseTxProposal();
    }, 0);

    return this.pool.stack(ident, arrayCommand);
  }

  private doReleaseTxProposal(retry: number = 0) {
    const p = this.pool.release();
    if (p) {
      this.network.processMessage(new TxProposal().create(p, retry).pack());
    }

    // retry
    retry++;
    this.timeoutRelease = setTimeout(() => {
      this.doReleaseTxProposal(retry);
    }, this.config.pbft_retry_ms);
  }

  private processTxProposal(proposal: TxProposal): boolean {
    const p: TxProposalStruct = proposal.get();

    // accept only valid transaction proposals
    if (!this.validation.validateTx(p.height, p.tx)) {
      return false;
    }

    if (!this.pool.add(p)) {
      return false;
    }

    clearTimeout(this.timeoutLock);
    this.timeoutLock = setTimeout(() => {
      this.doLock();
    }, this.config.pbft_lock_ms);

    return true;
  }

  private doLock(retry: number = 0) {
    const hash = this.pool.getHash();
    if (hash) {
      // send out the lock (which is a VoteStruct)
      this.network.processMessage(
        new Lock()
          .create(
            {
              origin: this.wallet.getPublicKey(),
              hash: hash,
              sig: this.wallet.sign(hash),
            },
            retry
          )
          .pack()
      );

      // retry
      retry++;
      this.timeoutLock = setTimeout(() => {
        this.doLock(retry);
      }, this.config.pbft_retry_ms);
    }
  }

  private processLock(lock: Lock): boolean {
    const l: VoteStruct = lock.get();

    // process only valid locks
    if (!Lock.isValid(l) || !this.pool.lock(l)) {
      return false;
    }

    if (this.pool.hasLock()) {
      clearTimeout(this.timeoutVote);
      this.timeoutVote = setTimeout(() => {
        this.doVote();
      }, 0);
    }

    return true;
  }

  private doVote(retry: number = 0) {
    const block = this.pool.getBlock();
    if (block.hash) {
      // send out the vote
      this.network.processMessage(
        new Vote()
          .create(
            {
              origin: this.wallet.getPublicKey(),
              hash: block.hash,
              sig: this.wallet.sign(block.hash),
            },
            retry
          )
          .pack()
      );

      // retry
      retry++;
      this.timeoutVote = setTimeout(() => {
        this.doVote(retry);
      }, this.config.pbft_retry_ms);
    }
  }

  private processVote(vote: Vote): boolean {
    const v: VoteStruct = vote.get();

    // process only valid votes
    if (!Vote.isValid(v)) {
      return false;
    }

    // check the quorum and add the block if reached
    this.pool.addVote(v) && this.addBlock(this.pool.getBlock());

    return true;
  }

  private processSync(sync: Sync): boolean {
    this.stackSync = this.stackSync.concat(sync.get()).sort((a, b) => (a.height > b.height ? 1 : -1));

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

    return true;
  }

  private addBlock(block: BlockStruct) {
    clearTimeout(this.timeoutRelease);
    clearTimeout(this.timeoutLock);
    clearTimeout(this.timeoutVote);

    if (this.blockchain.add(block)) {
      //@FIXME logging
      Logger.trace('Added block ' + block.height);

      this.pool.clear(block);

      setImmediate((s: string) => {
        this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(s));
      }, JSON.stringify(block));
    }

    this.timeoutRelease = setTimeout(() => {
      this.doReleaseTxProposal();
    }, 0);
  }

  private onMessage(type: number, message: Buffer | string): boolean {
    switch (type) {
      case Message.TYPE_TX_PROPOSAL:
        return this.processTxProposal(new TxProposal(message));
      case Message.TYPE_LOCK:
        return this.processLock(new Lock(message));
      case Message.TYPE_VOTE:
        return this.processVote(new Vote(message));
      case Message.TYPE_SYNC:
        return this.processSync(new Sync(message));
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
