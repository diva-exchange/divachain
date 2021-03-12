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

import { NUMBER_OF_NODES } from './config';
import { Server } from './p2p/server';

import { TransactionPool } from './pool/transaction-pool';
import { Validators } from './transaction/validators';
import { Blockchain } from './blockchain/blockchain';
import { BlockPool } from './pool/block-pool';
import { CommitPool } from './pool/commit-pool';
import { VotePool } from './pool/vote-pool';
import { MessagePool } from './pool/message-pool';
import { Wallet } from './transaction/wallet';
import { Logger } from './logger';

const wallet = new Wallet(process.env.SECRET || '');
const transactionPool = new TransactionPool();
const validators = new Validators(NUMBER_OF_NODES);
const blockchain = new Blockchain();
const blockPool = new BlockPool();
const votePool = new VotePool();
const commitPool = new CommitPool();
const messagePool = new MessagePool();

const server = new Server(
  blockchain,
  transactionPool,
  wallet,
  blockPool,
  votePool,
  commitPool,
  messagePool,
  validators
);

server.listen().then(() => {
  process.on('unhandledRejection', (error: Error) => {
    Logger.trace(error);
    process.exit(1);
  });

  process.once('SIGINT', () => {
    server.shutdown().then(() => {
      process.exit(0);
    });
  });
});
