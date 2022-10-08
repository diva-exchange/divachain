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
import { Blockchain } from '../chain/blockchain';
import { nanoid } from 'nanoid';
import { Validation } from './validation';
import { AddTx } from './message/add-tx';
import { Logger } from '../logger';
import { Config } from '../config';
import { Block, BlockStruct } from '../chain/block';
import { Message } from './message/message';
import { Sync } from './message/sync';
import { ProposeBlock } from './message/propose-block';
import { SignBlock } from './message/sign-block';
import { ConfirmBlock } from './message/confirm-block';

const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;

type recordStack = {
  ident: string;
  commands: ArrayCommand;
};

export type recordTx = {
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

  private timeoutAddTx: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutDeadValidator: NodeJS.Timeout = {} as NodeJS.Timeout;

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

  calcValidator(): void {
    const hash = this.blockchain.getLatestBlock().hash;
    let min = hash.length;
    let a: Array<string> = [];
    //hamming distance
    this.network.getArrayOnline().forEach((pk) => {
      if (pk.length === hash.length) {
        let dist = 0;
        for (let i = 0; i < hash.length && dist <= min; i++) {
          dist += hash[i] !== pk[i] ? 1 : 0;
        }
        if (dist <= min) {
          dist < min ? (a = [pk]) : a.unshift(pk);
          min = dist;
        }
      }
    });
    this.validator = a.length > 1 ? a.sort()[(this.blockchain.getHeight() + 1) % a.length] : a[0] || '';
  }

  private isValidator(origin: string = this.wallet.getPublicKey()) {
    return origin === this.validator;
  }

  //@FIXME testing only
  getMapValidatorDist() {
    return [...this.mapValidatorDist.entries()];
  }

  stack(commands: ArrayCommand, ident: string = ''): string | false {
    const height = this.blockchain.getHeight() + 1;
    ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(DEFAULT_LENGTH_IDENT);
    if (!this.validation.validateTx(height, new Transaction(this.wallet, height, ident, commands).get())) {
      return false;
    }

    this.stackTransaction.push({ ident: ident, commands: commands });
    setImmediate(() => {
      this.doAddTx();
    });
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
        // accept only, if validator
        this.isValidator() && this.processAddTx(new AddTx(m.pack()));
        break;
      case Message.TYPE_PROPOSE_BLOCK:
        // accept only from validator
        this.isValidator(m.origin()) && this.processProposeBlock(new ProposeBlock(m.pack()));
        break;
      case Message.TYPE_SIGN_BLOCK:
        // accept only, if validator
        this.isValidator() && this.processSignBlock(new SignBlock(m.pack()));
        break;
      case Message.TYPE_CONFIRM_BLOCK:
        // accept only from validator
        this.isValidator(m.origin()) && this.processConfirmBlock(new ConfirmBlock(m.pack()));
        break;
      case Message.TYPE_SYNC:
        this.processSync(new Sync(m.pack()));
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

    //@FIXME logging
    Logger.trace(`${this.config.port}: Validator - ${this.validator}`);

    const atx: AddTx = new AddTx().create(this.wallet, this.validator, height, tx);
    this.isValidator() ? this.processAddTx(atx) : this.network.broadcast(atx);

    //@FIXME constant
    this.timeoutDeadValidator = setTimeout(() => {
      this.clear();
      setImmediate(() => {
        this.doAddTx();
      });
    }, 30000);
  }

  // Validator process: incoming transaction
  private processAddTx(addTx: AddTx) {
    // process only valid incoming tx's
    const height = this.blockchain.getHeight() + 1;
    if (
      this.hasBlock() ||
      addTx.height() !== height ||
      this.current.has(addTx.origin()) ||
      !this.validation.validateTx(height, addTx.tx()) ||
      !AddTx.isValid(addTx)
    ) {
      return;
    }

    this.current.set(addTx.origin(), addTx.tx());
    this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));

    clearTimeout(this.timeoutAddTx);
    this.timeoutAddTx = setTimeout(() => {
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
      !ProposeBlock.isValid(proposeBlock) ||
      !this.validation.validateBlock(proposeBlock.block(), false)
    ) {
      return;
    }

    this.block = proposeBlock.block();
    this.network.broadcast(new SignBlock().create(this.wallet, this.validator, this.block.hash));
  }

  // Validator process: incoming signature for block
  private processSignBlock(signBlock: SignBlock) {
    // process only valid signatures
    if (
      this.block.hash !== signBlock.hash() ||
      this.block.votes.length >= this.blockchain.getQuorum() ||
      this.block.votes.some((v) => v.origin === signBlock.origin()) ||
      !SignBlock.isValid(signBlock)
    ) {
      return;
    }

    if (
      this.block.votes.push({ origin: signBlock.origin(), sig: signBlock.sigBlock() }) >= this.blockchain.getQuorum()
    ) {
      //@FIXME logging
      Logger.trace(`Adding Block #${this.block.height}`);

      // broadcast confirmation
      this.network.broadcast(new ConfirmBlock().create(this.wallet, this.block.hash, this.block.votes));
      this.addBlock(this.block);
    }
  }

  private processConfirmBlock(confirmBlock: ConfirmBlock) {
    // process only valid confirmations
    if (!this.hasBlock() || !ConfirmBlock.isValid(confirmBlock) || this.block.hash !== confirmBlock.hash()) {
      return;
    }

    //@FIXME testing only
    this.mapValidatorDist.set(this.validator, (this.mapValidatorDist.get(this.validator) || 0) + 1);

    this.block.votes = confirmBlock.votes();
    this.addBlock(this.block);
  }

  private processSync(sync: Sync) {
    if (this.blockchain.getHeight() + 1 === sync.block().height) {
      this.addBlock(sync.block());
    }
  }

  private addBlock(block: BlockStruct) {
    if (!this.blockchain.add(block)) {
      Logger.trace(`${JSON.stringify(block)}`);
      throw new Error(`${this.config.port}: addBlock failed`);
    }

    clearTimeout(this.timeoutDeadValidator);
    this.clear(block);
    this.calcValidator();
    this.server.feedBlock(block);

    setImmediate(() => {
      this.doAddTx();
    });
  }

  private clear(block: BlockStruct = {} as BlockStruct) {
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
}
