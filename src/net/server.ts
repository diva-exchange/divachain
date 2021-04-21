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
import Hapi from '@hapi/hapi';
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

const VERSION = '0.1.0';

export class Server {
  public readonly httpServer: Hapi.Server;
  public readonly network: Network;
  public readonly transactionPool: TransactionPool;
  public readonly blockPool: BlockPool;
  public readonly votePool: VotePool;
  public readonly commitPool: CommitPool;
  public readonly blockchain: Blockchain;

  private readonly config: Config;
  private readonly wallet: Wallet;
  private readonly api: Api;

  constructor(config: Config) {
    Logger.info(`divachain ${VERSION} instantiating...`);
    this.config = config;
    this.wallet = new Wallet(this.config);
    this.transactionPool = new TransactionPool(this.wallet);
    this.blockPool = new BlockPool();
    this.votePool = new VotePool();
    this.commitPool = new CommitPool();

    this.network = new Network(this.config, this.wallet, async (type: number, message: Buffer | string) => {
      await this.onMessage(type, message);
    });
    this.blockchain = new Blockchain(this.config, this.network);

    this.httpServer = Hapi.server({
      address: this.config.http_ip,
      port: this.config.http_port,
    });

    this.api = new Api(this, this.wallet);
  }

  async listen(): Promise<Server> {
    await this.blockchain.init();

    this.api.init();

    await this.httpServer.start();
    Logger.info(`HTTP Server listening on ${this.config.http_ip}:${this.config.http_port}`);

    this.httpServer.events.on('stop', () => {
      Logger.info(`HTTP Server on ${this.config.http_ip}:${this.config.http_port} closed`);
    });

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

  stackTransaction(t: TransactionStruct): boolean {
    if (!this.transactionPool.stack(t)) {
      return false;
    }

    setImmediate(() => {
      this.createProposal();
    });
    return true;
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
    if (!Vote.isValid(v)) {
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
    if (this.blockchain.getHeight() >= c.block.height) {
      return;
    }

    if (!Commit.isValid(c, this.network.getQuorum())) {
      //@FIXME logging
      Logger.trace(`processCommit(): invalid commit ${commit.ident()}`);
      return this.network.stopGossip(commit.ident());
    }

    if (!this.commitPool.add(c)) {
      return;
    }

    const blockAccepted: BlockStruct | false = this.commitPool.accepted(this.network.getQuorum());
    if (blockAccepted) {
      this.network.processMessage(
        new Confirm()
          .create({
            origin: this.wallet.getPublicKey(),
            block: blockAccepted,
            sig: this.wallet.sign(blockAccepted.hash + JSON.stringify(blockAccepted.votes)),
          })
          .pack()
      );
    }
  }

  private processConfirm(confirm: Confirm) {
    const c: VoteStruct = confirm.get();
    if (this.blockchain.getHeight() >= c.block.height) {
      return;
    }

    if (!Commit.isValid(c, this.network.getQuorum())) {
      //@FIXME logging
      Logger.trace(`processConfirm(): invalid commit ${confirm.ident()}`);
      return this.network.stopGossip(confirm.ident());
    }

    this.blockchain.add(c.block).then(() => {
      this.votePool.clear();
      this.commitPool.clear(c.block);
      this.blockPool.clear();
      this.transactionPool.clear(c.block);

      const nextBlock = this.commitPool.best();
      if (c.block.height + 1 === nextBlock.height) {
        this.transactionPool.add(nextBlock.tx);
      }
      // if there should be another transaction on the stack: release and process it!
      setImmediate(() => {
        this.createProposal();
      });
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
      default:
        throw new Error('Invalid message type');
    }
  }
}
