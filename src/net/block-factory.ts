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

  private timeoutAddTx: NodeJS.Timeout = {} as NodeJS.Timeout;

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

  getValidator(): string {
    const i: number = (this.blockchain.getHeight() + 1) % this.network.getArrayNetwork().length;
    return this.network.getArrayNetwork()[i].publicKey;
  }

  isValidator(origin: string = this.wallet.getPublicKey()) {
    return origin === this.getValidator();
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
    const height = this.blockchain.getHeight() + 1;
    while (!this.ownTx.height && this.stackTransaction.length) {
      const r: recordStack = this.stackTransaction.shift() as recordStack;
      const tx: TransactionStruct = new Transaction(this.wallet, height, r.ident, r.commands).get();

      if (this.validation.validateTx(height, tx)) {
        this.ownTx = {
          height: height,
          tx: tx,
        };

        const atx: AddTx = new AddTx().create(this.wallet, this.getValidator(), height, tx);
        this.isValidator() ? this.processAddTx(atx) : this.network.broadcast(atx);
      }
    }
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
    this.network.broadcast(new SignBlock().create(this.wallet, this.getValidator(), this.block.hash));
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

    this.clear(block);
    this.server.feedBlock(block);

    setImmediate(() => {
      this.doAddTx();
    });
  }

  private clear(block: BlockStruct) {
    if (
      this.ownTx.height &&
      !block.tx.some((t) => {
        return t.sig === this.ownTx.tx.sig;
      })
    ) {
      this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
    }

    this.ownTx = {} as recordTx;

    this.current = new Map();
    this.arrayPoolTx = [];

    this.block = {} as BlockStruct;
  }
}
