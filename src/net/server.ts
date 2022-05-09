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
import { Vote, VoteStruct } from './message/vote';
import { Proposal, ProposalStruct } from './message/proposal';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private pool: Pool = {} as Pool;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;
  private validation: Validation = {} as Validation;

  private intervalProposal: NodeJS.Timeout = {} as NodeJS.Timeout;
  private intervalVote: NodeJS.Timeout = {} as NodeJS.Timeout;

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

    // standalone Websocket Server to feed block updates
    this.webSocketServerBlockFeed = new WebSocket.Server({
      host: this.config.ip,
      port: this.config.port_block_feed,
    });
    this.webSocketServerBlockFeed.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: any) => {
        Logger.warn('Server webSocketServerBlockFeed.error: ' + error.toString());
        ws.terminate();
      });
    });
    this.webSocketServerBlockFeed.on('close', () => {
      Logger.info('WebSocketServerBlockFeed closing');
    });
  }

  async start(): Promise<Server> {
    Logger.info(`HTTP endpoint ${this.config.http}`);
    Logger.info(`UDP endpoint ${this.config.udp}`);

    this.wallet = Wallet.make(this.config);
    Logger.info('Wallet initialized');

    this.blockchain = await Blockchain.make(this);
    if (this.blockchain.getHeight() === 0) {
      await this.blockchain.reset(Blockchain.genesis(this.config.path_genesis));
    }
    Logger.info('Blockchain initialized');

    this.validation = Validation.make(this);
    Logger.info('Validation initialized');

    this.pool = Pool.make(this);
    Logger.info('Pool initialized');

    await this.httpServer.listen(this.config.port, this.config.ip);

    this.network = Network.make(this, (m: Message) => {
      return this.onMessage(m);
    });

    // schedule proposing
    this.intervalProposal = setInterval(() => {
      this.doPropose();
    }, this.config.network_clean_interval_ms);

    // schedule voting
    this.intervalVote = setInterval(() => {
      this.doVote();
    }, Math.floor(this.config.network_clean_interval_ms * 1.5));

    return new Promise((resolve) => {
      this.network.once('ready', async () => {
        this.bootstrap = Bootstrap.make(this);
        if (this.config.bootstrap) {
          await this.bootstrap.syncWithNetwork();
          if (!this.blockchain.hasNetworkHttp(this.config.http)) {
            await this.bootstrap.enterNetwork(this.wallet.getPublicKey());
          }
        }

        resolve(this);
      });
    });
  }

  async shutdown(): Promise<void> {
    clearInterval(this.intervalProposal);
    clearInterval(this.intervalVote);

    this.network.shutdown();
    this.wallet.close();
    await this.blockchain.shutdown();

    if (this.httpServer) {
      return await new Promise((resolve) => {
        this.httpServer.close(() => {
          resolve();
        });
      });
    }
    return Promise.resolve();
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

  getBlockchain(): Blockchain {
    return this.blockchain;
  }

  getValidation(): Validation {
    return this.validation;
  }

  getNetwork(): Network {
    return this.network;
  }

  stackTx(commands: ArrayCommand, ident: string = '') {
    const i = this.pool.stack(commands, ident);
    if (!i) {
      return false;
    }
    this.doPropose();
    return i;
  }

  private doPropose() {
    this.pool.release();
    const p = this.pool.getProposal();
    if (p) {
      this.processProposal(p);
      // distribute own proposal
      this.network.broadcast(p);
    }
  }

  sync() {
    (async () => {
      const arrayBlocks: Array<BlockStruct> = await this.getNetwork().fetchFromApi(
        'sync/' + this.getBlockchain().getHeight()
      );
      for (const b of arrayBlocks) {
        this.addBlock(b);
      }
    })();
  }

  private processProposal(proposal: Proposal) {
    const p: ProposalStruct = proposal.get();

    // process only valid proposals
    if (!Proposal.isValid(p)) {
      return;
    }

    // add proposal to pool
    if (!this.pool.propose(p)) {
      return;
    }

    // distribute proposal
    this.network.broadcast(proposal);
  }

  private doVote() {
    const v = this.pool.lock();

    if (v) {
      this.processVote(v);
      // distribute own vote
      this.network.broadcast(v);
    }
  }

  private processVote(vote: Vote) {
    const v: VoteStruct = vote.get();

    // process only valid votes
    // stateful
    if (!Vote.isValid(v)) {
      return;
    }

    // add vote to pool
    if (!this.pool.vote(v)) {
      return;
    }

    // re-distribute vote
    this.network.broadcast(vote);

    // if a block is available, add it to the chain
    if (this.pool.hasBlock()) {
      this.addBlock(this.pool.getBlock());
    }
  }

  private addBlock(block: BlockStruct) {
    if (!this.blockchain.add(block)) {
      return;
    }

    this.pool.clear(block);

    setImmediate((s: string) => {
      this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(s));
    }, JSON.stringify(block));

    setTimeout(() => {
      this.doPropose();
    }, 0);
  }

  private onMessage(m: Message) {
    switch (m.type()) {
      case Message.TYPE_PROPOSAL:
        this.processProposal(new Proposal(m.pack()));
        break;
      case Message.TYPE_VOTE:
        this.processVote(new Vote(m.pack()));
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
