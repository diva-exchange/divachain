/**
 * Copyright (C) 2022 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from './server';
import { Network } from './network';
import { Wallet } from '../chain/wallet';
import { ArrayCommand, Transaction, TransactionStruct } from '../chain/transaction';
import { Blockchain, Peer } from '../chain/blockchain';
import { nanoid } from 'nanoid';
import { Validation } from './validation';
import { AddTx } from './message/add-tx';
import { Logger } from '../logger';
import {
  Config,
  STAKE_PING_AMOUNT,
  STAKE_PING_IDENT,
  STAKE_PING_QUARTILE_COEFF_MAX,
  STAKE_PING_QUARTILE_COEFF_MIN,
  STAKE_PING_SAMPLE_SIZE,
} from '../config';
import { Block, BlockStruct } from '../chain/block';
import { Message } from './message/message';
import { ProposeBlock } from './message/propose-block';
import { SignBlock } from './message/sign-block';
import { ConfirmBlock, VoteStruct } from './message/confirm-block';
import { Status, ONLINE, OFFLINE } from './message/status';
import { Util } from '../chain/util';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

type recordTx = {
  height: number;
  tx: TransactionStruct;
};

export class BlockFactory {
  private readonly server: Server;
  private readonly config: Config;
  private readonly blockchain: Blockchain;
  private readonly network: Network;
  private readonly validation: Validation;
  private readonly wallet: Wallet;

  private stackTransaction: Array<recordStack> = [];
  private ownTx: recordTx = {} as recordTx;

  private current: Map<string, TransactionStruct> = new Map(); // Map<origin, TransactionStruct>
  private arrayPoolTx: Array<TransactionStruct> = [];

  private block: BlockStruct = {} as BlockStruct;
  private validator: string = '';
  private mapValidatorDist: Map<string, number> = new Map();
  private mapAvailability: Map<string, Array<number>> = new Map();
  private isSyncing: boolean = false;

  private timeoutAddTx: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutProposeBlock: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutRetry: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server): BlockFactory {
    return new BlockFactory(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.config = server.config;
    this.blockchain = server.getBlockchain();
    this.network = server.getNetwork();
    this.validation = server.getValidation();
    this.wallet = server.getWallet();
  }

  shutdown() {
    this.removeTimeout();
  }

  // round-robin, respecting online peers
  private calcValidator(): void {
    const a: Array<string> = this.network.getArrayNetwork().map((p: Peer) => p.publicKey);
    let i: number = this.blockchain.getHeight() % a.length;
    if (!this.network.isOnline(a[i])) {
      i = Util.stringDiff(this.blockchain.getLatestBlock().hash, this.blockchain.getLatestBlock().previousHash);
      i = i % a.length;
    }

    while (!this.network.isOnline(a[i])) {
      i++;
      i = i >= a.length ? 0 : i;
    }
    this.validator = a[i];
  }

  private isValidator(origin: string = this.wallet.getPublicKey()) {
    return origin === this.validator;
  }

  //@FIXME testing only
  getMapValidatorDist() {
    return [...this.mapValidatorDist.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1));
  }

  stack(commands: ArrayCommand, ident: string = ''): string | false {
    const height = this.blockchain.getHeight() + 1;
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);
    if (!this.validation.validateTx(height, new Transaction(this.wallet, height, ident, commands).get())) {
      return false;
    }

    this.stackTransaction.push({ ident: ident, commands: commands });
    this.doAddTx();
    return ident;
  }

  getStack() {
    return this.stackTransaction;
  }

  hasBlock(): boolean {
    return this.block.height > 0;
  }

  processMessage(m: Message) {
    switch (m.type()) {
      case Message.TYPE_ADD_TX:
      case Message.TYPE_PROPOSE_BLOCK:
      case Message.TYPE_SIGN_BLOCK:
      case Message.TYPE_CONFIRM_BLOCK:
        this.calcValidator();
        break;
    }

    switch (m.type()) {
      case Message.TYPE_ADD_TX:
        // accept only, if validator
        this.isValidator() && this.processAddTx(new AddTx(m.asBuffer()));
        break;
      case Message.TYPE_PROPOSE_BLOCK:
        // accept only from validator
        this.isValidator(m.origin()) && this.processProposeBlock(new ProposeBlock(m.asBuffer()));
        break;
      case Message.TYPE_SIGN_BLOCK:
        // accept only, if validator
        this.isValidator() && this.processSignBlock(new SignBlock(m.asBuffer()));
        break;
      case Message.TYPE_CONFIRM_BLOCK:
        // accept only from validator
        this.isValidator(m.origin()) && this.processConfirmBlock(new ConfirmBlock(m.asBuffer()));
        break;
      case Message.TYPE_STATUS:
        this.processStatus(new Status(m.asBuffer()));
        break;
      default:
        throw new Error('Invalid message type');
    }
  }

  private doAddTx() {
    if (this.ownTx.height || !this.stackTransaction.length) {
      return;
    }

    const height = this.blockchain.getHeight() + 1;
    const r: recordStack = this.stackTransaction.shift() as recordStack;
    const tx: TransactionStruct = new Transaction(this.wallet, height, r.ident, r.commands).get();

    this.ownTx = {
      height: height,
      tx: tx,
    };

    // send to validator only
    this.calcValidator();
    const atx: AddTx = new AddTx().create(this.wallet, this.validator, height, tx);
    this.isValidator() ? this.processAddTx(atx) : this.network.broadcast(atx);

    this.setupRetry();
  }

  // Validator process: incoming transaction
  private processAddTx(addTx: AddTx) {
    // process only valid incoming transactions
    const height = this.blockchain.getHeight() + 1;
    if (
      this.hasBlock() ||
      addTx.height() !== height ||
      this.current.has(addTx.origin()) ||
      !this.validation.validateTx(height, addTx.tx())
    ) {
      return;
    }

    this.current.set(addTx.origin(), addTx.tx());
    this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));

    clearTimeout(this.timeoutProposeBlock);
    this.timeoutProposeBlock = setTimeout(() => {
      // create a block proposal
      this.block = Block.make(this.blockchain.getLatestBlock(), this.arrayPoolTx);
      this.block.votes.push({
        origin: this.wallet.getPublicKey(),
        sig: this.wallet.sign(this.block.hash),
      });

      this.network.broadcast(new ProposeBlock().create(this.wallet, this.block));
    }, (this.network.getArrayNetwork().length - this.arrayPoolTx.length) * 250);
  }

  // incoming block - sign or drop
  private processProposeBlock(proposeBlock: ProposeBlock) {
    // process only valid block candidates for next block
    if (
      proposeBlock.height() !== this.blockchain.getHeight() + 1 ||
      proposeBlock.block().previousHash !== this.blockchain.getLatestBlock().hash ||
      !this.validation.validateBlock(proposeBlock.block(), false)
    ) {
      return;
    }

    // send to validator only
    this.block = proposeBlock.block();
    this.calcValidator();
    const sb: SignBlock = new SignBlock().create(this.wallet, this.validator, this.block.hash);
    this.isValidator() ? this.processSignBlock(sb) : this.network.broadcast(sb);

    this.setupRetry();
  }

  // Validator process: incoming signature for block
  private processSignBlock(signBlock: SignBlock) {
    // process only valid signatures
    if (this.block.hash !== signBlock.hash() || this.block.votes.some((v) => v.origin === signBlock.origin())) {
      return;
    }

    this.block.votes.push({ origin: signBlock.origin(), sig: signBlock.sig() });
    if (this.blockchain.hasQuorumWeighted(this.block.votes.map((vs: VoteStruct) => vs.origin))) {
      // add the block to the chain
      (async (block: BlockStruct) => {
        await this.addBlock(block);
      })(this.block);

      // broadcast confirmation
      this.network.broadcast(new ConfirmBlock().create(this.wallet, this.block.hash, this.block.votes));
    }
  }

  private processConfirmBlock(confirmBlock: ConfirmBlock) {
    // process only valid confirmations
    if (!this.hasBlock() || this.block.hash !== confirmBlock.hash()) {
      return;
    }

    this.block.votes = confirmBlock.votes();
    (async (block: BlockStruct) => {
      await this.addBlock(block);
    })(this.block);
  }

  private processStatus(status: Status) {
    let a: Array<number>;
    const h: number = this.blockchain.getHeight();
    switch (status.status()) {
      case ONLINE:
        // fetch sync packets
        if (!this.isSyncing && h < status.height()) {
          this.isSyncing = true;

          //@FIXME logging
          Logger.trace(`${this.server.config.port} isSyncing ${h} -> ${status.height()}`);

          // fetch blocks and process them
          (async () => {
            for (const block of (await this.network.fetchFromApi('sync/' + (h + 1))) || []) {
              await this.addBlock(block);
            }
            this.isSyncing = false;
          })();
        }

        // PoS influence: availability
        // statistical dispersion of pings of a peer. Desired behaviour?
        // holding a local map of the availability of other peers and create a vote
        a = this.mapAvailability.get(status.origin()) || [];
        a.push(Date.now());

        // compare mapAvailability with a wanted behaviour (=dispersion of values, quartile coefficient)
        if (a.length >= STAKE_PING_SAMPLE_SIZE) {
          // calculate quartile coefficient
          const qc = Util.QuartileCoeff(a);
          if (qc >= STAKE_PING_QUARTILE_COEFF_MIN && qc <= STAKE_PING_QUARTILE_COEFF_MAX) {
            // place a vote for stake increase
            this.server.proposeModifyStake(status.origin(), STAKE_PING_IDENT, STAKE_PING_AMOUNT);
          }

          // remove 2/3rd of the data
          a = a.slice(-1 * Math.floor((a.length / 3) * 2));
        }
        this.mapAvailability.set(status.origin(), a);

        break;
      case OFFLINE:
        Logger.trace(`${this.config.port}: OFFLINE status`);
        break;
      default:
        Logger.warn(`${this.config.port}: Unknown status: ${status.status()}`);
    }
  }

  private async addBlock(block: BlockStruct) {
    if (!(await this.blockchain.add(block))) {
      Logger.error(`${this.config.port}: addBlock failed - ${block.height}`);
      return;
    }

    this.clear(block);
    this.calcValidator();
    this.timeoutAddTx = setTimeout(() => {
      this.doAddTx();
    }, 50);
    this.server.feedBlock(block);

    //@FIXME testing only
    this.mapValidatorDist.set(this.validator, (this.mapValidatorDist.get(this.validator) || 0) + 1);
  }

  private clear(block: BlockStruct = {} as BlockStruct) {
    this.removeTimeout();

    if (
      this.ownTx.height &&
      (!block.height ||
        !block.tx.some((t) => {
          return t.sig === this.ownTx.tx.sig;
        }))
    ) {
      this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
    }

    this.ownTx = {} as recordTx;
    this.current = new Map();
    this.arrayPoolTx = [];
    this.block = {} as BlockStruct;
  }

  private setupRetry() {
    clearTimeout(this.timeoutRetry);
    this.timeoutRetry = setTimeout(() => {
      Logger.info('Retrying to generate consensus...');
      this.clear();
      this.doAddTx();
    }, this.config.network_p2p_interval_ms * 2);
  }

  private removeTimeout() {
    clearTimeout(this.timeoutAddTx);
    clearTimeout(this.timeoutProposeBlock);
    clearTimeout(this.timeoutRetry);
  }
}
