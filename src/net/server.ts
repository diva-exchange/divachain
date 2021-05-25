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
  public readonly wallet: Wallet;

  public readonly network: Network;
  public readonly transactionPool: TransactionPool;
  public readonly blockPool: BlockPool;
  public readonly votePool: VotePool;
  public readonly commitPool: CommitPool;
  public readonly blockchain: Blockchain;

  public readonly app: Express;
  public readonly httpServer: http.Server;
  public readonly webSocketServer: WebSocket.Server;

  private staleBlockHash: string = '';

  constructor(config: Config) {
    this.config = config;
    Logger.info(`divachain ${this.config.VERSION} instantiating...`);
    Logger.trace(config);

    this.wallet = new Wallet(this.config);
    this.transactionPool = new TransactionPool(this.wallet);
    this.blockPool = new BlockPool();
    this.votePool = new VotePool();
    this.commitPool = new CommitPool();

    this.network = new Network(this, async (type: number, message: Buffer | string) => {
      await this.onMessage(type, message);
    });
    this.blockchain = new Blockchain(this.config, this.network);

    this.app = express();
    // generic
    this.app.set('x-powered-by', false);

    // compression
    this.app.use(compression());

    // json
    this.app.use(express.json());

    // routes
    new Api(this, this.wallet);

    // catch unavailable favicon.ico
    this.app.get('/favicon.ico', (req, res) => res.sendStatus(204));

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

  async listen(): Promise<Server> {
    this.network.init();
    Logger.info('Network initialized');

    await this.blockchain.init();
    Logger.info('Blockchain initialized');

    await this.httpServer.listen(this.config.port, this.config.ip);

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

    const newBlock: BlockStruct = new Block(
      this.blockchain.getLatestBlock(),
      this.transactionPool.get().concat(this.transactionPool.getInTransit())
    ).get();
    this.blockPool.set(newBlock);

    // vote for the best available version
    this.doVote(newBlock);
  }

  private processVote(vote: Vote) {
    const v = vote.get();
    if (!Vote.isValid(v) || this.blockchain.getHeight() >= v.block.height) {
      return this.network.stopGossip(vote.ident());
    }
    if (this.blockchain.getHeight() + 1 !== v.block.height) {
      return;
    }

    if (v.block.hash === this.blockPool.get().hash) {
      if (this.votePool.add(v, this.network.getQuorum())) {
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

    const newBlock = new Block(this.blockchain.getLatestBlock(), this.transactionPool.get()).get();
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
    if (this.blockchain.getHeight() >= c.block.height || !Commit.isValid(c, this.network.getQuorum())) {
      return this.network.stopGossip(commit.ident());
    }

    if (!this.commitPool.add(c)) {
      return;
    }

    if (this.commitPool.accepted(this.network.getQuorum())) {
      const block = this.commitPool.best();
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
        if (this.votePool.add({ origin: v.origin, block: c.block, sig: v.sig }, this.network.getQuorum())) {
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

  private processConfirm(confirm: Confirm) {
    const c: VoteStruct = confirm.get();
    if (this.blockchain.getHeight() >= c.block.height || !Commit.isValid(c, this.network.getQuorum())) {
      return this.network.stopGossip(confirm.ident());
    }

    this.blockchain
      .add(c.block)
      .then(() => {
        this.votePool.clear();
        this.commitPool.clear(c.block);
        this.blockPool.clear();
        this.transactionPool.clear(c.block);

        const nextBlock = this.commitPool.best();
        if (c.block.height + 1 === nextBlock.height) {
          this.transactionPool.add(nextBlock.tx);
        }
        // if there is another transaction on the stack: release and process it!
        setImmediate(() => {
          this.createProposal();
        });
      })
      .catch((error) => {
        Logger.warn(error);
      });
  }

  private processSync(sync: Sync) {
    sync.get().forEach(async (block) => {
      try {
        if (this.blockchain.getHeight() < block.height) {
          await this.blockchain.add(block);
        }
      } catch (error) {
        Logger.warn(error);
      }
    });
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
        this.processConfirm(new Confirm(message));
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
