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
import { Proposal, ProposalStruct } from './message/proposal';
import { Vote } from './message/vote';
import { Commit } from './message/commit';
import { VOTE_DELAY } from '../config';
import { Api } from './api';

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
  static readonly STATUS_ACCEPTING = 1;
  static readonly STATUS_VOTING = 2;
  static readonly STATUS_COMMITTING = 3;
  static readonly STATUS_OUT_OF_SYNC = 9;

  public readonly httpServer: Hapi.Server;
  public readonly network: Network;
  public readonly blockchain: Blockchain;
  public readonly transactionPool: TransactionPool;
  public readonly votePool: VotePool;
  public readonly blockPool: BlockPool;
  public status: number;

  private readonly config: ConfigServer;
  private readonly wallet: Wallet;
  private readonly api: Api;

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

    this.api = new Api(this, this.wallet);
  }

  async listen(): Promise<Server> {
    await this.blockchain.init();

    this.api.init();

    await this.httpServer.start();
    Logger.info(`HTTP Server (${VERSION}) listening on ${this.config.http_ip}:${this.config.http_port}`);

    this.httpServer.events.on('stop', () => {
      Logger.info(`HTTP Server (${VERSION}) on ${this.config.http_ip}:${this.config.http_port} closed`);
    });

    this.status = Server.STATUS_ACCEPTING;

    return this;
  }

  async shutdown(): Promise<void> {
    this.wallet.close();

    await this.network.shutdown();
    await this.blockchain.shutdown();

    if (typeof this.httpServer !== 'undefined' && this.httpServer) {
      await this.httpServer.stop();
    }
  }

  createProposal() {
    if (!this.transactionPool.get().length) {
      return;
    }

    const block = new Block(this.blockchain.getLatestBlock(), this.transactionPool.get());

    this.network.processMessage(
      new Proposal()
        .create({
          origin: this.wallet.getPublicKey(),
          block: block.get(),
          sig: this.wallet.sign(block.get().hash),
        })
        .pack()
    );
  }

  private processProposal(proposal: Proposal) {
    const p: ProposalStruct = proposal.get();
    // invalid Block proposal
    if (!this.blockchain.isValid(p.block)) {
      return this.network.stopGossip(proposal.ident());
    }
    this.status = Server.STATUS_VOTING;

    const arrayTx = this.blockPool.get().tx || [];

    if (arrayTx.length <= p.block.tx.length) {
      if (this.transactionPool.add(p.block.tx)) {
        // instruct the network to not further propagate the old proposal
        this.network.stopGossip(proposal.ident());

        const updatedBlock = new Block(this.blockchain.getLatestBlock(), this.transactionPool.get());

        this.network.processMessage(
          new Proposal()
            .create({
              origin: this.wallet.getPublicKey(),
              block: updatedBlock.get(),
              sig: this.wallet.sign(updatedBlock.get().hash),
            })
            .pack()
        );
      } else if (arrayTx.length < p.block.tx.length) {
        this.blockPool.set(p.block);
        const ident = proposal.ident();
        setTimeout(() => {
          this.doVote(ident, p.block.hash);
        }, VOTE_DELAY);
      }

      return;
    }

    this.network.stopGossip(proposal.ident());
  }

  private doVote(ident: string, hash: string) {
    if (this.blockPool.get().hash !== hash) {
      return this.network.stopGossip(ident);
    }

    const vote = new Vote().create({
      origin: this.wallet.getPublicKey(),
      hash: hash,
      sig: this.wallet.sign(hash),
    });
    this.network.processMessage(vote.pack());
  }

  private processVote(vote: Vote) {
    const v = vote.get();
    const b: BlockStruct = this.blockPool.get();
    if (b.hash !== v.hash) {
      return this.network.stopGossip(vote.ident());
    }

    this.votePool.add(v);

    if (this.votePool.accepted()) {
      this.status = Server.STATUS_COMMITTING;

      const votes = this.votePool.get();

      const commit = new Commit().create({
        origin: this.wallet.getPublicKey(),
        block: b,
        votes: votes,
        sig: this.wallet.sign(b.hash + JSON.stringify(votes)),
      });
      this.network.processMessage(commit.pack());
    }
  }

  private processCommit(commit: Commit) {
    const c = commit.get();
    if (this.blockchain.has(c.block.hash)) {
      return;
    }

    if (Commit.isValid(c) && this.blockchain.isValid(c.block)) {
      c.block.votes = c.votes;
      this.blockchain.add(c.block);
      this.clearPools();
      this.status = Server.STATUS_ACCEPTING;
      this.createProposal();
    } else {
      this.network.stopGossip(commit.ident());
    }
  }

  private clearPools() {
    this.blockPool.clear();
    this.votePool.clear();
    this.transactionPool.clear();
  }

  private onMessage(type: number, message: Buffer | string) {
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
        throw new Error('Invalid message type');
    }
  }
}
