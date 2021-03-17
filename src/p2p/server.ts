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

import {
  NUMBER_OF_NODES,
  HTTP_IP,
  HTTP_PORT,
  P2P_IP,
  P2P_PORT,
  P2P_NETWORK,
  P2P_MIN_HEALTH,
  MIN_APPROVALS,
} from '../config';
import { Logger } from '../logger';
import Hapi from '@hapi/hapi';

import { Blockchain } from '../blockchain/blockchain';
import { TransactionPool } from '../pool/transaction-pool';
import { Wallet } from '../transaction/wallet';
import { BlockPool } from '../pool/block-pool';
import { VotePool } from '../pool/vote-pool';
import { CommitPool } from '../pool/commit-pool';
import { MessagePool } from '../pool/message-pool';
import { Validators } from '../transaction/validators';
import { Network } from './network';
import { Message } from './message/message';
import { Transaction } from './message/transaction';
import { Proposal } from './message/proposal';
import { Vote } from './message/vote';
import { Commit } from './message/commit';

const VERSION = '0.1.0';

export class Server {
  private readonly network: Network;
  private readonly blockchain: Blockchain;
  private readonly transactionPool: TransactionPool;
  private readonly wallet: Wallet;
  private readonly blockPool: BlockPool;
  private readonly votePool: VotePool;
  private readonly commitPool: CommitPool;
  private readonly messagePool: MessagePool;
  private readonly validators: Validators;

  private readonly httpServer: Hapi.Server;

  constructor() {
    this.wallet = new Wallet(process.env.SECRET || '');
    this.blockchain = new Blockchain(this.wallet.getPublicKey());
    this.transactionPool = new TransactionPool();
    this.blockPool = new BlockPool();
    this.votePool = new VotePool();
    this.commitPool = new CommitPool();
    this.messagePool = new MessagePool();
    this.validators = new Validators(NUMBER_OF_NODES);

    this.network = new Network({
      ip: P2P_IP,
      port: P2P_PORT,
      networkPeers: P2P_NETWORK,
      onMessageCallback: async (m: Message) => {
        this.onMessage(m);
      },
    });

    this.httpServer = Hapi.server({
      address: HTTP_IP,
      port: HTTP_PORT,
    });
  }

  async listen(): Promise<void> {
    await this.blockchain.init();
    //@FIXME logging
    Logger.trace(this.blockchain.chain);

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
      path: '/peers',
      handler: (request, h) => {
        return h.response(this.network.peers());
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
      path: '/transactions',
      handler: (request, h) => {
        return h.response(this.transactionPool.transactions);
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/votes',
      handler: (request, h) => {
        return h.response(this.votePool.list);
      },
    });

    this.httpServer.route({
      method: 'GET',
      path: '/blocks',
      handler: (request, h) => {
        return h.response(this.blockchain.chain);
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/create',
      handler: async (request, h) => {
        try {
          const t = this.wallet.createTransaction(request.payload);
          this.processTransaction(t);
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
  }

  async shutdown(): Promise<void> {
    await this.network.shutdown();

    if (typeof this.httpServer !== 'undefined' && this.httpServer) {
      await this.httpServer.stop();
    }
  }

  private processTransaction(transaction: Transaction) {
    if (this.network.health().total < P2P_MIN_HEALTH) {
      throw new Error('Network not healthy');
    }

    if (
      !this.transactionPool.exists(transaction.getData()) &&
      TransactionPool.verify(transaction.getData()) &&
      this.validators.isValid(transaction.getData().publicKey)
    ) {
      // (re-)broadcast it (spread it all over)
      this.network.broadcast(transaction);

      if (this.transactionPool.add(transaction.getData())) {
        //@FIXME logging
        Logger.trace('Threshold reached...');

        if (this.blockchain.getProposer() === this.wallet.getPublicKey()) {
          //@FIXME logging
          Logger.trace('Proposing Block...');

          const block = this.blockchain.createBlock(this.transactionPool.transactions, this.wallet);
          this.processProposal(this.wallet.createProposal(block));
        }
      } else {
        //@FIXME logging
        Logger.trace('Transaction Added');
      }
    }
  }

  private processProposal(proposal: Proposal) {
    if (!this.blockPool.exists(proposal.getData().block) && this.blockchain.isValid(proposal.getData().block)) {
      // (re-)broadcast it (spread it all over)
      this.network.broadcast(proposal);

      this.blockPool.add(proposal.getData().block);

      //@FIXME logging
      Logger.trace('Creating Vote...');

      const v = this.wallet.createVote(proposal.getData().block);
      this.network.broadcast(v);
      this.processVote(v);
    }
  }

  private processVote(vote: Vote) {
    // check if the prepare message is valid
    if (
      !this.votePool.exists(vote.getData()) &&
      VotePool.isValid(vote.getData()) &&
      this.validators.isValid(vote.getData().publicKey)
    ) {
      this.votePool.add(vote.getData());

      //@FIXME logging
      Logger.trace(`Voting result: ${this.votePool.list[vote.getData().hash].length} >= ${MIN_APPROVALS}`);

      if (this.votePool.list[vote.getData().hash].length >= MIN_APPROVALS) {
        //@FIXME logging
        Logger.trace('Got approval - committing...');

        const c = this.wallet.createCommit(vote.getData());
        this.network.broadcast(c);
        this.processCommit(c);
      } else {
        this.network.broadcast(vote);
      }
    }
  }

  private processCommit(commit: Commit) {
    if (
      !this.commitPool.exists(commit.getData()) &&
      CommitPool.isValid(commit.getData()) &&
      this.validators.isValid(commit.getData().publicKey)
    ) {
      this.commitPool.add(commit.getData());

      //@FIXME logging
      Logger.trace(`Committing result: ${this.commitPool.list[commit.getData().hash].length} >= ${MIN_APPROVALS}`);

      if (this.commitPool.list[commit.getData().hash].length >= MIN_APPROVALS) {
        this.blockchain.add(commit.getData().hash, this.blockPool, this.votePool, this.commitPool);
        /*
        // Send a round change message to nodes
        const message = this.messagePool.createMessage(
          this.blockchain.chain[this.blockchain.chain.length - 1].hash,
          this.wallet
        );
        // this.network.broadcast(this.wallet.createRoundChange(proposal.getData()));
        */
      } else {
        this.network.broadcast(commit);
      }
    }
  }

  private onMessage(message: Message) {
    switch (message.type()) {
      case Message.TYPE_TRANSACTION:
        this.processTransaction(message as Transaction);
        break;
      case Message.TYPE_PROPOSAL:
        this.processProposal(message as Proposal);
        break;
      case Message.TYPE_VOTE:
        this.processVote(message as Vote);
        break;
      case Message.TYPE_COMMIT:
        this.processCommit(message as Commit);
        break;
      /*
      case Message.TYPE_ROUND_CHANGE:
        // check the validity of the round change message
        if (
          !this.messagePool.existingMessage(data.message) &&
          MessagePool.isValidMessage(data.message) &&
          this.validators.isValidValidator(data.message.publicKey)
        ) {
          // add to pool
          this.messagePool.addMessage(data.message);

          // send to other nodes
          this.broadcastRoundChange(data.message);

          // if enough messages are received, clear the pools
          if (this.messagePool.list[data.message.blockHash].length >= MIN_APPROVALS) {
            this.transactionPool.clear();
          }
        }
        break;
*/
    }
  }

  /*
  broadcastRoundChange(message: Message): void {
    const msg = JSON.stringify({
      type: MESSAGE_TYPE.round_change,
      message: message,
    });
    this.onMessage(Buffer.from(msg));
    this.wss.clients.forEach((socket) => {
      socket.send(msg);
    });
  }
*/
}
