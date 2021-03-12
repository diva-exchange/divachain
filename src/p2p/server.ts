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

import { HTTP_IP, HTTP_PORT, P2P_IP, P2P_PORT, MIN_APPROVALS } from '../config';
import { Logger } from '../logger';
import * as Hapi from '@hapi/hapi';

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
  private network: Network;
  private blockchain: Blockchain;
  private readonly transactionPool: TransactionPool;
  private readonly wallet: Wallet;
  private readonly blockPool: BlockPool;
  private readonly votePool: VotePool;
  private readonly commitPool: CommitPool;
  private messagePool: MessagePool;
  private validators: Validators;

  private readonly httpServer: Hapi.Server;

  constructor(
    blockchain: Blockchain,
    transactionPool: TransactionPool,
    wallet: Wallet,
    blockPool: BlockPool,
    votePool: VotePool,
    commitPool: CommitPool,
    messagePool: MessagePool,
    validators: Validators
  ) {
    this.blockchain = blockchain;
    this.transactionPool = transactionPool;
    this.wallet = wallet;
    this.blockPool = blockPool;
    this.votePool = votePool;
    this.commitPool = commitPool;
    this.messagePool = messagePool;
    this.validators = validators;

    this.network = new Network({
      ip: P2P_IP,
      port: P2P_PORT,
      networkPeers: {
        '8IokiGIWO1tZv3STHERC0Vq3+obO0uBnKh9UvVKOSlc=': {
          host: '47hul5deyozlp5juumxvqtx6wmut5ertroga3gej4wtjlc6wcsya.b32.i2p',
          port: 17168,
        },
        'HJT9oYoNO9N/K0pOQpAuV8KB4mbFTMccqOf68zrAGFw=': {
          host: 'o4jj2ldln3eelvqtc3hbauge274a4wun7nrnlnv54v44p6pz4lwa.b32.i2p',
          port: 17268,
        },
        'HKBpJ48a+jTQrugsnHHDTuaMJmOIzcz/HcV9KumsQ6A=': {
          host: 'yi2yzuqjeu7bvcltpdhlcwozdrfvhwvr42wgysmsoocw72vu5rca.b32.i2p',
          port: 17368,
        },
      },
      onMessageCallback: async (message: Buffer) => {
        this.onMessage(message);
      },
    });

    this.httpServer = Hapi.server({
      address: HTTP_IP,
      port: HTTP_PORT,
    });
  }

  async listen(): Promise<void> {
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
        const t = this.wallet.createTransaction(request.payload);
        this.network.broadcast(t);
        this.processTransaction(t);
        return h.response('Create Response').code(200);
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/peer/add',
      handler: (request, h) => {
        Logger.trace(request.payload.toString());
        return h.response().code(200);
      },
    });

    this.httpServer.route({
      method: 'POST',
      path: '/peer/remove',
      handler: (request, h) => {
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
    if (
      !this.transactionPool.exists(transaction.get().data) &&
      TransactionPool.verify(transaction.get().data) &&
      this.validators.isValid(transaction.get().data.publicKey)
    ) {
      const thresholdReached = this.transactionPool.add(transaction.get().data);

      // check if limit reached
      if (thresholdReached) {
        //@FIXME logging
        Logger.trace('Threshold reached...');

        if (this.blockchain.getProposer() === this.wallet.getPublicKey()) {
          //@FIXME logging
          Logger.trace('Proposing Block...');

          const block = this.blockchain.createBlock(this.transactionPool.transactions, this.wallet);
          const p = this.wallet.createProposal(block);
          this.network.broadcast(p);
          this.processProposal(p);
        }
      } else {
        //@FIXME logging
        Logger.trace('Transaction Added');
      }
    }
  }

  private processProposal(proposal: Proposal) {
    if (!this.blockPool.exists(proposal.get().data.block) && this.blockchain.isValid(proposal.get().data.block)) {
      this.blockPool.add(proposal.get().data.block);

      //@FIXME logging
      Logger.trace('Creating Vote...');
      const v = this.wallet.createVote(proposal.get().data.block);
      this.network.broadcast(v);
      this.processVote(v);
    }
  }

  private processVote(vote: Vote) {
    // check if the prepare message is valid
    if (
      !this.votePool.exists(vote.get().data) &&
      VotePool.isValid(vote.get().data) &&
      this.validators.isValid(vote.get().data.publicKey)
    ) {
      this.votePool.add(vote.get().data);

      Logger.trace(`VotePool.list ${JSON.stringify(this.votePool.list)}`);
      Logger.trace(`${this.votePool.list[vote.get().data.hash].length} >= ${MIN_APPROVALS}`);

      if (this.votePool.list[vote.get().data.hash].length >= MIN_APPROVALS) {
        //@FIXME logging
        Logger.trace('Got approval - committing...');
        const c = this.wallet.createCommit(vote.get().data);
        this.network.broadcast(c);
        this.processCommit(c);
      }
    }
  }

  private processCommit(commit: Commit) {
    if (
      !this.commitPool.exists(commit.get().data) &&
      CommitPool.isValid(commit.get().data) &&
      this.validators.isValid(commit.get().data.publicKey)
    ) {
      this.commitPool.add(commit.get().data);

      if (this.commitPool.list[commit.get().data.hash].length >= MIN_APPROVALS) {
        this.blockchain.add(commit.get().data.hash, this.blockPool, this.votePool, this.commitPool);
      }

      /*
      // Send a round change message to nodes
      const message = this.messagePool.createMessage(
        this.blockchain.chain[this.blockchain.chain.length - 1].hash,
        this.wallet
      );
      // this.network.broadcast(this.wallet.createRoundChange(proposal.get().data));
      */
    }
  }

  private onMessage(message: Buffer) {
    const m = new Message(message);

    switch (m.type()) {
      case Message.TYPE_TRANSACTION:
        this.processTransaction(m as Transaction);
        break;
      case Message.TYPE_PROPOSAL:
        this.processProposal(m as Proposal);
        break;
      case Message.TYPE_VOTE:
        this.processVote(m as Vote);
        break;
      case Message.TYPE_COMMIT:
        this.processCommit(m as Commit);
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

    this.network.broadcast(m);
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
