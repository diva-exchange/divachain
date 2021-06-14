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
import { BlockPool } from '../pool/block-pool';
import { VotePool } from '../pool/vote-pool';
import { Network } from './network';
import { Message } from './message/message';
import { Vote, VoteStruct } from './message/vote';
import { Commit } from './message/commit';
import { Api } from './api';
import { TransactionStruct } from '../chain/transaction';
import { CommitPool } from '../pool/commit-pool';
import { Confirm } from './message/confirm';
import { Sync } from './message/sync';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServer: WebSocket.Server;

  private transactionPool: TransactionPool = {} as TransactionPool;
  private blockPool: BlockPool = {} as BlockPool;
  private votePool: VotePool = {} as VotePool;
  private commitPool: CommitPool = {} as CommitPool;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;

  private staleBlockHash: string = '';

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
        Logger.trace(error);
        ws.terminate();
      });
    });
    this.webSocketServer.on('close', () => {
      Logger.info('WebSocketServer closing');
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
    this.blockPool = new BlockPool();
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

    // check for stale blocks
    this.checkBlockPool();

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

  getBlockPool(): BlockPool {
    return this.blockPool;
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

    setImmediate(() => {
      this.createProposal();
    });
    return true;
  }

  private checkBlockPool() {
    const block = this.blockPool.get();
    if (this.staleBlockHash === block.hash) {
      this.network.resetGossip();
      this.doVote(block);
    }
    this.staleBlockHash = block.hash || '';

    setTimeout(() => {
      this.checkBlockPool();
    }, this.config.block_pool_check_interval_ms);
  }

  private createProposal() {
    if (!this.transactionPool.release()) {
      return;
    }

    const newBlock: BlockStruct = Block.make(
      this.blockchain.getLatestBlock(),
      this.transactionPool.get().concat(this.transactionPool.getInTransit())
    );
    this.blockPool.set(newBlock);

    // vote for the best available version
    this.doVote(newBlock);
  }

  private processVote(vote: Vote) {
    const v = vote.get();
    Block.validate(v.block);

    if (!Vote.isValid(v) || this.blockchain.getHeight() >= v.block.height) {
      return this.network.stopGossip(vote.ident());
    }
    if (this.blockchain.getHeight() + 1 !== v.block.height) {
      return;
    }

    if (v.block.hash === this.blockPool.get().hash) {
      if (this.votePool.add(v, this.network.getStake(v.origin), this.network.getQuorum())) {
        v.block.votes = this.votePool.get(v.block.hash);
        this.network.processMessage(
          new Commit()
            .create({
              origin: this.wallet.getPublicKey(),
              block: v.block,
              sig: this.wallet.sign(v.block.hash + JSON.stringify(v.block.votes)),
            })
            .pack()
        );
      }
      return;
    }

    if (!this.transactionPool.add(v.block.tx)) {
      return this.network.stopGossip(vote.ident());
    }

    const newBlock = Block.make(this.blockchain.getLatestBlock(), this.transactionPool.get());
    this.blockPool.set(newBlock);

    // vote for the best available version
    this.doVote(newBlock);
  }

  private doVote(block: BlockStruct) {
    // vote for the best available version
    setImmediate(() => {
      this.network.processMessage(
        new Vote()
          .create({
            origin: this.wallet.getPublicKey(),
            block: block,
            sig: this.wallet.sign(block.hash),
          })
          .pack()
      );
    });
  }

  private processCommit(commit: Commit) {
    const c: VoteStruct = commit.get();

    let sumStake = 0;
    c.block.votes.forEach((v) => {
      sumStake = sumStake + this.network.getStake(v.origin);
    });

    if (this.blockchain.getHeight() >= c.block.height || sumStake < this.network.getQuorum() || !Commit.isValid(c)) {
      return this.network.stopGossip(commit.ident());
    }

    if (!this.commitPool.add(c)) {
      return;
    }

    const block = this.commitPool.best();
    sumStake = 0;
    block.votes.forEach((v) => {
      sumStake = sumStake + this.network.getStake(v.origin);
    });
    if (sumStake >= this.network.getQuorum()) {
      this.network.processMessage(
        new Confirm()
          .create({
            origin: this.wallet.getPublicKey(),
            block: block,
            sig: this.wallet.sign(block.hash + JSON.stringify(block.votes)),
          })
          .pack()
      );
    } else if (c.block.hash === this.blockPool.get().hash) {
      for (const v of c.block.votes) {
        if (
          this.votePool.add(
            { origin: v.origin, block: c.block, sig: v.sig },
            this.network.getStake(v.origin),
            this.network.getQuorum()
          )
        ) {
          c.block.votes = this.votePool.get(c.block.hash);
          this.network.processMessage(
            new Commit()
              .create({
                origin: this.wallet.getPublicKey(),
                block: c.block,
                sig: this.wallet.sign(c.block.hash + JSON.stringify(c.block.votes)),
              })
              .pack()
          );
          break;
        }
      }
    }
  }

  private async processConfirm(confirm: Confirm) {
    const c: VoteStruct = confirm.get();

    let sumStake = 0;
    c.block.votes.forEach((v) => {
      sumStake = sumStake + this.network.getStake(v.origin);
    });

    if (this.blockchain.getHeight() >= c.block.height || sumStake < this.network.getQuorum() || !Commit.isValid(c)) {
      return this.network.stopGossip(confirm.ident());
    }

    await this.blockchain.add(c.block);

    const nextBlock = this.commitPool.best();
    if (c.block.height + 1 === nextBlock.height) {
      this.transactionPool.add(nextBlock.tx);
    }
    // if there is another transaction on the stack: release and process it!
    setImmediate(() => {
      this.createProposal();
    });
  }

  private async processSync(sync: Sync) {
    const h = this.blockchain.getHeight();
    for (const block of sync.get().filter((b) => h < b.height)) {
      await this.blockchain.add(block);
    }
  }

  private async onMessage(type: number, message: Buffer | string) {
    switch (type) {
      case Message.TYPE_VOTE:
        this.processVote(new Vote(message));
        break;
      case Message.TYPE_COMMIT:
        this.processCommit(new Commit(message));
        break;
      case Message.TYPE_CONFIRM:
        await this.processConfirm(new Confirm(message));
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
