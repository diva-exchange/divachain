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
import { Lock, LockStruct } from './message/lock';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServer: WebSocket.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private pool: Pool = {} as Pool;
  private timeoutLock: NodeJS.Timeout = {} as NodeJS.Timeout;

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
        Logger.warn(error);
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
        Logger.warn(error);
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
    setImmediate(() => {
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
      }
    });
  }

  private processTxProposal(proposal: TxProposal): boolean {
    const p: TxProposalStruct = proposal.get();
    const h: number = this.blockchain.getHeight() + 1;

    // accept only valid transaction proposals
    if (!TxProposal.isValid(p)) {
      return false;
    }

    // process only data matching the next block height
    if (h === p.height && this.pool.add(p.tx)) {
      this.lockTransactionPool();
    }

    return true;
  }

  private lockTransactionPool() {
    clearTimeout(this.timeoutLock);
    this.timeoutLock = setTimeout(() => {
      if (this.pool.hasLock()) {
        return;
      }

      const hash = this.pool.getHash();
      if (hash) {
        //@FIXME logging
        Logger.trace(`Sending Lock ${hash}`);

        // send out the lock
        this.network.processMessage(
          new Lock()
            .create({
              origin: this.wallet.getPublicKey(),
              hash: hash,
              sig: this.wallet.sign(hash),
            })
            .pack()
        );
      }
    }, (Math.pow(this.network.getSizeNetwork() / this.network.getPeers(), 2)) * 270);
  }

  private processLock(lock: Lock): boolean {
    const l: LockStruct = lock.get();

    if (!Lock.isValid(l)) {
      return false;
    }

    if (!this.pool.lock(l, this.network.getStake(l.origin), this.network.getQuorum())) {
      this.lockTransactionPool();
      return false;
    }

    this.pool.hasLock() && this.doVote();

    return true;
  }

  private doVote() {
    setImmediate(() => {
      const block = this.pool.getBlock();
      if (block) {
        //@FIXME logging
        Logger.trace(`${this.wallet.getPublicKey()}: voting for Block ${block.hash}`);

        // send out the vote
        this.network.processMessage(
          new Vote()
            .create({
              origin: this.wallet.getPublicKey(),
              block: block,
              sig: this.wallet.sign(block.hash),
            })
            .pack()
        );
      }
    });
  }

  private processVote(vote: Vote): boolean {
    const v: VoteStruct = vote.get();

    // invalid vote - abort messaging
    if (!Vote.isValid(v)) {
      return false;
    }

    if (!this.pool.addVote(v, this.network.getStake(v.origin))) {
      return false;
    }

    // check the quorum
    if (this.pool.hasQuorum(this.network.getQuorum())) {
      const block = this.pool.getBlock();
      block && this.addBlock(block);
    }

    return true;
  }

  private processSync(sync: Sync) {
    this.stackSync = this.stackSync.concat(sync.get());

    setImmediate(() => {
      const max = this.stackSync.length * 2;
      if (!max) {
        return;
      }

      let h = this.blockchain.getHeight();
      let b: BlockStruct = (this.stackSync.shift() || {}) as BlockStruct;
      let c = 0;
      while (b.height && c < max) {
        if (b.height === h + 1) {
          this.addBlock(b);
          h = this.blockchain.getHeight();
        } else if (b.height > h + 1) {
          this.stackSync.push(b);
        }
        b = (this.stackSync.shift() || {}) as BlockStruct;
        c++;
      }
    });
  }

  private addBlock(block: BlockStruct) {
    if (this.blockchain.add(block)) {
      this.pool.clear(block);
      this.releaseTxProposal();

      setImmediate(() => {
        const feed = JSON.stringify(block);
        this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(feed));
      });
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
