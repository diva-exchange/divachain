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

import { Block } from './block';
import { NUMBER_OF_NODES } from '../config';
import { Validators } from '../transaction/validators';
import { Wallet } from '../transaction/wallet';
import { BlockPool } from '../pool/block-pool';
import { CommitPool } from '../pool/commit-pool';
import { Logger } from '../logger';
import { VotePool } from '../pool/vote-pool';
import { TransactionStruct } from '../p2p/message/transaction';

export class Blockchain {
  validatorList: Array<string>;
  chain: Array<Block>;

  constructor() {
    this.validatorList = Validators.generateAddresses(NUMBER_OF_NODES);
    this.chain = [Block.genesis()];
  }

  // wrapper function to create blocks
  createBlock(transactions: Array<TransactionStruct>, wallet: Wallet): Block {
    return Block.createBlock(this.chain[this.chain.length - 1], transactions, wallet);
  }

  // @FIXME genesis has a hash of '000...', so the first proposer is always known
  getProposer(): string {
    //const index = this.chain[this.chain.length - 1].hash[0].charCodeAt(0) % NUMBER_OF_NODES;
    return this.validatorList[0];
    //return this.validatorList[index];
  }

  isValid(block: Block): boolean {
    const previousBlock = this.chain[this.chain.length - 1];
    if (
      previousBlock.height + 1 === block.height &&
      block.previousHash === previousBlock.hash &&
      block.hash === Block.blockHash(block) &&
      Block.verifyBlock(block) &&
      Block.verifyProposer(block, this.getProposer())
    ) {
      //@FIXME logging
      Logger.trace('Blockchain.isValid(): true');
      return true;
    } else {
      //@FIXME logging
      Logger.trace('Blockchain.isValid(): false');
      return false;
    }
  }

  add(hash: string, blockPool: BlockPool, votePool: VotePool, commitPool: CommitPool): void {
    //@FIXME logging
    Logger.trace('Blockchain.add()');

    const block = blockPool.getBlock(hash);
    block.votes = votePool.list[hash] || [];
    block.commits = commitPool.list[hash] || [];
    this.chain.push(block);
  }
}
