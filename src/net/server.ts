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

import { Logger } from '../logger';
import Hapi from '@hapi/hapi';

import { Block, BlockStruct } from '../chain/block';
import { Blockchain } from '../chain/blockchain';
import { TransactionPool } from '../pool/transaction-pool';
import { Wallet } from '../chain/wallet';
import { BlockPool } from '../pool/block-pool';
import { VotePool } from '../pool/vote-pool';
import { Network } from './network';
import { Message } from './message/message';
import { Transaction, TransactionStruct } from './message/transaction';
import { Proposal } from './message/proposal';
import { Vote } from './message/vote';
import { Commit } from './message/commit';

const VERSION = '0.1.0';

export type ConfigServer = {
  secret: string;
  p2p_ip: string;
  p2p_port: number;
  p2p_network: { [publicKey: string]: { host: string; port: number } };
  http_ip: string;
  http_port: number;
};

export class Server {
  static readonly STATUS_OUT_OF_SYNC = 1;
  static readonly STATUS_ACCEPTING = 2;
  static readonly STATUS_PROPOSING = 3;
  static readonly STATUS_VOTING = 4;

  private readonly config: ConfigServer;
  private readonly network: Network;
  private readonly transactionPool: TransactionPool;
  private readonly wallet: Wallet;
  private readonly blockchain: Blockchain;
  private readonly blockPool: BlockPool;
  private readonly votePool: VotePool;

  private readonly httpServer: Hapi.Server;

  private status: number;

  //@FIXME remove secret
  constructor(config: ConfigServer) {
    this.config = config;

    this.wallet = new Wallet(this.config.secret);
    this.blockchain = new Blockchain(this.wallet.getPublicKey());
    this.transactionPool = new TransactionPool();
    this.blockPool = new BlockPool();
    this.votePool = new VotePool();

    this.network = new Network(
      {
        ip: this.config.p2p_ip,
        port: this.config.p2p_port,
        networkPeers: this.config.p2p_network,
        onMessageCallback: (type: number, message: Buffer | string) => {
          this.onMessage(type, message);
        },
      },
      this.blockchain,
      this.wallet
    );

    this.httpServer = Hapi.server({
      address: this.config.http_ip,
      port: this.config.http_port,
    });

    this.status = Server.STATUS_OUT_OF_SYNC;
  }

  async listen(): Promise<Server> {
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
        return h.response(this.network.peers());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/network',
      handler: (request, h) => {
        return h.response(this.network.network());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/health',
      handler: (request, h) => {
        return h.response(this.network.health());
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/ack',
      handler: (request, h) => {
        return h.response(this.network.ack());
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
        return h.response(this.votePool.getList());
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
      method: 'PUT',
      path: '/block',
      handler: async (request, h) => {
        try {
          //@FIXME Array<object> is not specific enough, stateless validation needed using ajv
          const commands = request.payload as Array<object>;
          const transaction = new Transaction().create({
            origin: this.wallet.getPublicKey(),
            commands: commands,
            sig: this.wallet.sign(JSON.stringify(commands)),
          });
          this.createTransaction(transaction);
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
    Logger.info(`HTTP Server (${VERSION}) listening on ${this.config.http_ip}:${this.config.http_port}`);

    this.httpServer.events.on('stop', () => {
      Logger.info(`HTTP Server (${VERSION}) on ${this.config.http_ip}:${this.config.http_port} closed`);
    });

    this.status = Server.STATUS_ACCEPTING;

    return this;
  }

  async shutdown(): Promise<void> {
    await this.network.shutdown();
    await this.blockchain.shutdown();

    if (typeof this.httpServer !== 'undefined' && this.httpServer) {
      await this.httpServer.stop();
    }
  }

  private createTransaction(transaction: Transaction) {
    if (this.status !== Server.STATUS_ACCEPTING) {
      throw new Error('Not accepting transactions');
    }
    this.status = Server.STATUS_PROPOSING;

    const t: TransactionStruct = transaction.get();
    this.transactionPool.add(t);

    const block = new Block(this.blockchain.getLatestBlock(), [t], this.wallet);
    const proposal = new Proposal().create(block.get());
    this.network.processMessage(proposal.pack());
  }

  private processProposal(proposal: Proposal) {
    const b: BlockStruct = proposal.get();
    // invalid Block proposal
    if (!this.blockchain.isValid(b)) {
      return;
    }

    let localBlock = this.blockPool.get();
    if (localBlock && localBlock.sig != b.sig) {
      const t: TransactionStruct = this.transactionPool.get();
      if (this.status === Server.STATUS_PROPOSING && !b.tx.find((_t) => _t.sig !== t.sig)) {
        localBlock = new Block(this.blockchain.getLatestBlock(), b.tx.concat(t), this.wallet).get();
      }
      this.status = Server.STATUS_VOTING;

      if (localBlock.tx.length !== b.tx.length) {
        this.blockPool.set(b);

        //@FIXME logging
        Logger.trace(`createVote for hash: ${b.hash}`);
        const vote = new Vote().create({
          origin: this.wallet.getPublicKey(),
          hash: b.hash,
          sig: this.wallet.sign(b.hash),
        });
        this.network.processMessage(vote.pack());
      }
    }
  }

  private processVote(vote: Vote) {
    const v = vote.get();
    this.votePool.add(v);

    if (this.status === Server.STATUS_VOTING && this.votePool.accepted(v.hash)) {
      const votes = this.votePool.get(v.hash);

      //@FIXME logging
      Logger.trace(`createCommit: ${JSON.stringify(votes)}`);

      const commit = new Commit().create({
        origin: this.wallet.getPublicKey(),
        hash: v.hash,
        votes: votes,
        sig: this.wallet.sign(JSON.stringify(votes)),
      });
      this.network.processMessage(commit.pack());
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
      this.clearPools(c.hash);
      this.status = Server.STATUS_ACCEPTING;
    } else {
      this.status = Server.STATUS_OUT_OF_SYNC;
    }
  }

  private clearPools(hash: string) {
    this.blockPool.clear();
    this.votePool.clear(hash);
    this.transactionPool.clear();
  }

  private onMessage(type: number, message: Buffer | string) {
    try {
      switch (type) {
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
      }
    } catch (error) {
      Logger.trace(error);
    }
  }
}
