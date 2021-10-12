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
  private timeoutRelease: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutLock: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutVote: NodeJS.Timeout = {} as NodeJS.Timeout;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;

  private stackSync: Array<BlockStruct> = [];

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
      perMessageDeflate: true,
    });
    this.webSocketServer.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: Error) => {
        Logger.warn(JSON.stringify(error));
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
        Logger.warn(JSON.stringify(error));
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

    this.pool = new Pool(this.wallet, this.blockchain);

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

  stackTxProposal(arrayCommand: ArrayCommand, ident: string = ''): string | false {
    return this.pool.stack(ident, arrayCommand);
  }

  releaseTxProposal() {
    clearTimeout(this.timeoutRelease);
    this.doRelease();
  }

  private doRelease(t: number = this.config.pbft_min_timeout_ms) {
    const h = this.blockchain.getHeight() + 1;
    const tx = this.pool.release(h);
    if (tx) {
      this.network.processMessage(
        new TxProposal()
          .create({
            height: h,
            tx: tx,
          })
          .pack()
      );

      this.timeoutRelease = setTimeout(() => {
        this.doRelease(t > this.config.pbft_max_timeout_ms ? this.config.pbft_max_timeout_ms : t);
      }, Math.floor(t * this.config.pbft_growth_factor_timeout_ms));
    }
  }

  private processTxProposal(proposal: TxProposal): boolean {
    const p: TxProposalStruct = proposal.get();
    const h: number = this.blockchain.getHeight() + 1;

    // accept only valid transaction proposals
    // process only proposals matching the next block height
    if (!TxProposal.isValid(p) || h !== p.height) {
      return false;
    }

    // try to add the proposal to the pool
    if (this.pool.add(p.tx)) {
      clearTimeout(this.timeoutVote);
      clearTimeout(this.timeoutLock);
      this.timeoutLock = setTimeout(() => {
        this.doLock();
      }, 1);
    }

    return true;
  }

  private doLock(t: number = this.config.pbft_min_timeout_ms) {
    const hash = this.pool.getHash();
    if (hash) {
      // send out the lock (which is a VoteStruct)
      this.network.processMessage(
        new Lock()
          .create({
            origin: this.wallet.getPublicKey(),
            hash: hash,
            sig: this.wallet.sign(hash),
          })
          .pack()
      );

      this.timeoutLock = setTimeout(() => {
        this.doLock(t > this.config.pbft_max_timeout_ms ? this.config.pbft_max_timeout_ms : t);
      }, Math.floor(t * this.config.pbft_growth_factor_timeout_ms));
    }
  }

  private processLock(lock: Lock): boolean {
    const l: VoteStruct = lock.get();

    if (!Lock.isValid(l) || this.pool.hasLock()) {
      return false;
    }

    this.pool.lock(l, this.network.getStake(l.origin), this.network.getQuorum());

    if (this.pool.hasLock()) {
      clearTimeout(this.timeoutVote);
      this.timeoutVote = setTimeout(() => {
        this.doVote();
      }, 1);
    } else if (!this.pool.getArrayLocks().some((r) => r.origin === this.wallet.getPublicKey())) {
      clearTimeout(this.timeoutLock);
      this.timeoutLock = setTimeout(() => {
        this.doLock();
      }, 1);
    }

    return true;
  }

  private doVote(t: number = this.config.pbft_min_timeout_ms) {
    if (this.network.getStake(this.wallet.getPublicKey()) <= 0) {
      return;
    }

    const block = this.pool.getBlock();
    if (block.hash) {
      // send out the vote
      this.network.processMessage(
        new Vote()
          .create({
            origin: this.wallet.getPublicKey(),
            hash: block.hash,
            sig: this.wallet.sign(block.hash),
          })
          .pack()
      );

      this.timeoutVote = setTimeout(() => {
        this.doVote(t > this.config.pbft_max_timeout_ms ? this.config.pbft_max_timeout_ms : t);
      }, Math.floor(t * this.config.pbft_growth_factor_timeout_ms));
    }
  }

  private processVote(vote: Vote): boolean {
    const v: VoteStruct = vote.get();

    // invalid vote - abort messaging
    if (!Vote.isValid(v)) {
      return false;
    }

    // process only votes if pool is locked
    // process only votes with a stake > 0
    if (!this.pool.hasLock() || this.network.getStake(v.origin) <= 0) {
      return false;
    }

    if (!this.pool.addVote(v, this.network.getStake(v.origin))) {
      return false;
    }

    // check the quorum
    if (this.pool.hasQuorum(this.network.getQuorum())) {
      this.network.processMessage(new Sync().setBroadcast(true).create([this.pool.getBlock()]).pack());
    }

    return true;
  }

  private processSync(sync: Sync) {
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
  }

  private addBlock(block: BlockStruct) {
    if (this.blockchain.add(block)) {
      this.pool.clear(block);
      this.releaseTxProposal();

      (async () => {
        const feed = JSON.stringify(block);
        this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(feed));
      })();
    }
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
        this.processSync(new Sync(message));
        return true;
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
