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
import { Block, BlockStruct } from '../chain/block';
import { Blockchain } from '../chain/blockchain';
import { TransactionPool } from '../pool/transaction-pool';
import { Wallet } from '../chain/wallet';
import { VotePool } from '../pool/vote-pool';
import { Network } from './network';
import { Message } from './message/message';
import { Vote, VoteStruct } from './message/vote';
import { Commit } from './message/commit';
import { Api } from './api';
import { TransactionStruct } from '../chain/transaction';
import { Sync } from './message/sync';
import { CommitPool } from '../pool/commit-pool';
import { Util } from '../chain/util';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServer: WebSocket.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private transactionPool: TransactionPool = {} as TransactionPool;
  private votePool: VotePool = {} as VotePool;
  private commitPool: CommitPool = {} as CommitPool;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;

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
      perMessageDeflate: this.config.per_message_deflate,
    });
    this.webSocketServer.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: Error) => {
        //@FIXME logging
        Logger.trace(error);
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
        //@FIXME logging
        Logger.trace(error);
        ws.terminate();
      });
    });
    this.webSocketServerBlockFeed.on('close', () => {
      Logger.info('WebSocketServerBlockFeed closing');
    });
  }

  async start(): Promise<Server> {
    this.bootstrap = await Bootstrap.make(this);
    Logger.info(`Bootstrapped, address ${this.config.address}`);

    Logger.trace(this.config);

    this.wallet = Wallet.make(this.config);
    Logger.info('Wallet initialized');

    this.network = Network.make(this, async (type: number, message: Buffer | string) => {
      await this.onMessage(type, message);
    });
    Logger.info('Network initialized');

    // pools
    this.transactionPool = new TransactionPool(this.wallet);
    this.votePool = new VotePool();
    this.commitPool = new CommitPool();

    this.blockchain = await Blockchain.make(this);
    Logger.info('Blockchain initialized');

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

  getTransactionPool(): TransactionPool {
    return this.transactionPool;
  }

  getVotePool(): VotePool {
    return this.votePool;
  }

  getCommitPool(): CommitPool {
    return this.commitPool;
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

  stackTransaction(t: TransactionStruct): boolean {
    if (!this.transactionPool.stack(t)) {
      return false;
    }

    this.createProposal();
    return true;
  }

  private createProposal() {
    if (!this.transactionPool.release()) {
      return;
    }

    // vote for the best available version
    this.doVote(Block.make(this.blockchain.getLatestBlock(), this.transactionPool.get()));
  }

  private doVote(blc: BlockStruct) {
    // vote for the best available version
    setImmediate(() => {
      this.network.processMessage(
        new Vote()
          .create({
            orgn: this.wallet.getPublicKey(),
            blc: blc,
            sig: this.wallet.sign(blc.h),
          })
          .pack()
      );
    });
  }

  private processVote(vote: Vote) {
    const v = vote.get();

    // not interested in any data beyond the current new block
    if (this.blockchain.getHeight() + 1 !== v.blc.hght) {
      return this.network.stopGossip(vote.ident());
    }

    if (!Vote.isValid(v)) {
      return this.network.stopGossip(vote.ident());
    }

    // if there are locally unknown transactions within the block, create a new block and vote for it
    if (this.transactionPool.add(v.blc.tx)) {
      // vote for the best available block
      this.network.stopGossip(vote.ident());
      return this.doVote(Block.make(this.blockchain.getLatestBlock(), this.transactionPool.get()));
    }

    if (!this.votePool.add(v, this.network.getStake(v.orgn), this.network.getQuorum())) {
      return this.network.stopGossip(vote.ident());
    }

    if (this.votePool.hasQuorum) {
      v.blc.vts = this.votePool.get();
      setImmediate(() => {
        this.network.processMessage(
          new Commit()
            .create({
              orgn: this.wallet.getPublicKey(),
              blc: v.blc,
              sig: this.wallet.sign(Util.hash(v.blc.h + JSON.stringify(v.blc.vts))),
            })
            .pack()
        );
      });
    }
  }

  private async processCommit(commit: Commit) {
    const c: VoteStruct = commit.get();

    // not interested in any data beyond the current new block
    if (this.commitPool.hasQuorum || this.blockchain.getHeight() + 1 !== c.blc.hght) {
      return this.network.stopGossip(commit.ident());
    }

    if (!Commit.isValid(c)) {
      return this.network.stopGossip(commit.ident());
    }

    if (!this.commitPool.add(c, this.network.getStake(c.orgn), this.network.getQuorum())) {
      return this.network.stopGossip(commit.ident());
    }
    if (this.commitPool.hasQuorum) {
      await this.addBlock(c.blc);
    }
  }

  private async processSync(sync: Sync) {
    const h = this.blockchain.getHeight();
    for (const block of sync.get().filter((b) => h < b.hght)) {
      await this.addBlock(block);
    }
  }

  private async addBlock(block: BlockStruct) {
    await this.blockchain.add(block);
    this.createProposal();

    setImmediate(() => {
      const feed = JSON.stringify(block);
      this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(feed));
    });
  }

  private async onMessage(type: number, message: Buffer | string) {
    switch (type) {
      case Message.TYPE_VOTE:
        this.processVote(new Vote(message));
        break;
      case Message.TYPE_COMMIT:
        await this.processCommit(new Commit(message));
        break;
      case Message.TYPE_SYNC:
        await this.processSync(new Sync(message));
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
