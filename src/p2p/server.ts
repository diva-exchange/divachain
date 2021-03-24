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

import { HTTP_IP, HTTP_PORT, P2P_IP, P2P_PORT, P2P_NETWORK } from '../config';
import { Logger } from '../logger';
import Hapi from '@hapi/hapi';

import { Block, BlockStruct } from '../blockchain/block';
import { Blockchain } from '../blockchain/blockchain';
import { TransactionPool } from '../pool/transaction-pool';
import { Wallet } from '../blockchain/wallet';
import { BlockPool } from '../pool/block-pool';
import { VotePool } from '../pool/vote-pool';
import { Network } from './network';
import { Message } from './message/message';
import { Transaction, TransactionStruct } from './message/transaction';
import { Proposal } from './message/proposal';
import { Vote } from './message/vote';
import { Commit } from './message/commit';

const VERSION = '0.1.0';

export class Server {
  static readonly STATUS_OUT_OF_SYNC = 1;
  static readonly STATUS_ACCEPTING = 2;
  static readonly STATUS_VOTING = 3;

  private readonly network: Network;
  private readonly blockchain: Blockchain;
  private readonly transactionPool: TransactionPool;
  private readonly wallet: Wallet;
  private readonly blockPool: BlockPool;
  private readonly votePool: VotePool;

  private readonly httpServer: Hapi.Server;

  private status: number;

  constructor() {
    this.wallet = new Wallet(process.env.SECRET || '');
    this.blockchain = new Blockchain(this.wallet.getPublicKey());
    this.transactionPool = new TransactionPool();
    this.blockPool = new BlockPool();
    this.votePool = new VotePool();

    this.network = new Network(
      {
        ip: P2P_IP,
        port: P2P_PORT,
        networkPeers: P2P_NETWORK,
        onMessageCallback: (type: number, message: Buffer | string): boolean => {
          return this.onMessage(type, message);
        },
      },
      this.wallet
    );

    this.httpServer = Hapi.server({
      address: HTTP_IP,
      port: HTTP_PORT,
    });

    this.status = Server.STATUS_OUT_OF_SYNC;
  }

  async listen(): Promise<void> {
    await this.blockchain.init();

    // catch all
    this.httpServer.route({
      method: '*',
      path: '/{any*}',
      handler: (request, h) => {
        return h.response('404 - Not Found').code(404);
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/status',
      handler: (request, h) => {
        return h.response({ status: this.status });
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/peers',
      handler: (request, h) => {
        return h.response(this.network.getPeers());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/health',
      handler: (request, h) => {
        return h.response(this.network.getHealth());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/ack',
      handler: (request, h) => {
        return h.response(this.network.getAck());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/messages',
      handler: (request, h) => {
        return h.response(this.network.getMessages());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/pool/transactions',
      handler: (request, h) => {
        return h.response(this.transactionPool.get());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/pool/votes',
      handler: (request, h) => {
        return h.response(this.votePool.get());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/pool/blocks',
      handler: (request, h) => {
        return h.response(this.blockPool.get());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/blocks',
      handler: async (request, h) => {
        return h.response(await this.blockchain.get());
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/create',
      handler: async (request, h) => {
        try {
          const transactions = request.payload as Array<TransactionStruct>;
          const data = new Transaction().create({
            origin: this.wallet.getPublicKey(),
            transactions: transactions,
            signature: this.wallet.sign(JSON.stringify(transactions)),
          });
          this.processTransaction(data);
          this.network.broadcast(data.pack());
          return h.response().code(200);
        } catch (error) {
          Logger.trace(error);
          throw error;
        }
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/peer/add',
      handler: (request, h) => {
        //@FIXME logging
        Logger.trace(request.payload.toString());
        return h.response().code(200);
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/peer/remove',
      handler: (request, h) => {
        //@FIXME logging
        Logger.trace(request.payload.toString());
        return h.response().code(200);
      },
    });

    await this.httpServer.start();
    Logger.info(`HTTP Server listening on ${HTTP_IP}:${HTTP_PORT}`);

    this.httpServer.events.on('stop', () => {
      Logger.info(`HTTP Server (${VERSION}) closed`);
    });

    this.status = Server.STATUS_ACCEPTING;
  }

  async shutdown(): Promise<void> {
    await this.network.shutdown();
    await this.blockchain.shutdown();

    if (typeof this.httpServer !== 'undefined' && this.httpServer) {
      await this.httpServer.stop();
    }
  }

  private doPropose(): boolean {
    return this.network.isLeader(this.blockchain.getHeight()) && this.transactionPool.get().length > 1;
  }

  private processTransaction(transaction: Transaction) {
    if (this.status !== Server.STATUS_ACCEPTING) {
      throw new Error('Not accepting transactions');
    }

    this.transactionPool.add(transaction.get());

    if (this.doPropose()) {
      const block = new Block(this.blockchain.getLatestBlock(), this.transactionPool.get(), this.wallet);

      this.status = Server.STATUS_VOTING;
      const proposal = new Proposal().create(block.get());
      this.processProposal(proposal);
      this.network.broadcast(proposal.pack());
    }
  }

  private processProposal(proposal: Proposal) {
    const b: BlockStruct = proposal.get();
    if (b.origin === this.network.getLeader(b.height - 1) && this.blockchain.isValid(b)) {
      this.blockPool.set(b);

      //@FIXME logging
      Logger.trace(`createVote for hash: ${b.hash}`);
      const vote = new Vote().create({
        origin: this.wallet.getPublicKey(),
        hash: b.hash,
        signature: this.wallet.sign(b.hash),
      });
      this.processVote(vote);
      this.network.broadcast(vote.pack());
    }
  }

  private processVote(vote: Vote) {
    const v = vote.get();
    this.votePool.add(v);

    if (this.status === Server.STATUS_VOTING && this.votePool.accepted()) {
      const votes = this.votePool.get();

      //@FIXME logging
      Logger.trace(`createCommit: ${JSON.stringify(votes)}`);

      const commit = new Commit().create({
        origin: this.wallet.getPublicKey(),
        votes: this.votePool.get(),
        signature: this.wallet.sign(JSON.stringify(votes)),
      });
      this.processCommit(commit);
      this.network.broadcast(commit.pack());
    }
  }

  private processCommit(commit: Commit) {
    const block: BlockStruct = this.blockPool.get();
    if (!this.blockchain.isValid(block)) {
      return;
    }

    const c = commit.get();
    if (Commit.isValid(c)) {
      this.blockPool.commit(c.votes);
      this.blockchain.add(block);
      this.clearPools();
      this.status = Server.STATUS_ACCEPTING;
    } else {
      this.status = Server.STATUS_OUT_OF_SYNC;
    }
  }

  private clearPools() {
    this.blockPool.clear();
    this.votePool.clear();
    this.transactionPool.clear();
  }

  private onMessage(type: number, message: Buffer | string): boolean {
    let r = true;
    try {
      switch (type) {
        case Message.TYPE_ACK:
          break;
        case Message.TYPE_TRANSACTION:
          this.processTransaction(new Transaction(message));
          break;
        case Message.TYPE_PROPOSAL:
          this.processProposal(new Proposal(message));
          break;
        case Message.TYPE_VOTE:
          this.processVote(new Vote(message));
          break;
        case Message.TYPE_COMMIT:
          this.processCommit(new Commit(message));
          break;
        default:
          //@FIXME should be solved with generic message validation, using ajv
          //@FIXME logging
          Logger.error(`Unknown message type ${message.toString()}`);
          return false;
      }
    } catch (error) {
      Logger.trace(error);
      r = false;
    }

    return r;
  }
}
