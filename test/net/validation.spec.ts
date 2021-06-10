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

import { suite, test, slow } from '@testdeck/mocha';
import { expect } from 'chai';
import { Validation } from '../../src/net/validation';
import { Challenge } from '../../src/net/message/challenge';
import { Message } from '../../src/net/message/message';
import { nanoid } from 'nanoid';
import { Auth } from '../../src/net/message/auth';
import { Wallet } from '../../src/chain/wallet';
import { Blockchain } from '../../src/chain/blockchain';
import { Commit } from '../../src/net/message/commit';
import { Vote } from '../../src/net/message/vote';
import { BlockStruct } from '../../src/chain/block';
import { Confirm } from '../../src/net/message/confirm';
import { Config } from '../../src/config';
import path from 'path';

@suite
class TestValidation {
  private static config: Config;
  private static wallet: Wallet;

  @slow(200)
  static before() {
    TestValidation.config = new Config({
      path_genesis: path.join(__dirname, '../genesis/block.json'),
      path_state: path.join(__dirname, '../state'),
      path_blockstore: path.join(__dirname, '../blockstore'),
      path_keys: path.join(__dirname, '../keys'),
    });
    TestValidation.wallet = Wallet.make(TestValidation.config);
  }

  @slow(100)
  static after() {
    TestValidation.wallet.close();
  }

  @test
  validateAuth() {
    const m = new Auth().create(TestValidation.wallet.sign('test'));
    expect(Validation.validateMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateChallenge() {
    const m = new Challenge().create(nanoid(26));
    expect(Validation.validateMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateVote() {
    const structBlock = Blockchain.genesis(TestValidation.config.path_genesis);
    const structVote = {
      origin: TestValidation.wallet.getPublicKey(),
      block: structBlock,
      sig: TestValidation.wallet.sign(structBlock.hash),
    };
    const m = new Vote().create(structVote);
    expect(Validation.validateMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateCommit() {
    const structBlock: BlockStruct = Blockchain.genesis(TestValidation.config.path_genesis);
    structBlock.votes = [
      {
        origin: TestValidation.wallet.getPublicKey(),
        sig: TestValidation.wallet.sign(structBlock.hash),
      },
    ];
    const m = new Commit().create({
      origin: TestValidation.wallet.getPublicKey(),
      block: structBlock,
      sig: TestValidation.wallet.sign(structBlock.hash + JSON.stringify(structBlock.votes)),
    });
    expect(Validation.validateMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateConfirm() {
    const structBlock: BlockStruct = Blockchain.genesis(TestValidation.config.path_genesis);
    structBlock.votes = [
      {
        origin: TestValidation.wallet.getPublicKey(),
        sig: TestValidation.wallet.sign(structBlock.hash),
      },
    ];
    const m = new Confirm().create({
      origin: TestValidation.wallet.getPublicKey(),
      block: structBlock,
      sig: TestValidation.wallet.sign(structBlock.hash + JSON.stringify(structBlock.votes)),
    });
    expect(Validation.validateMessage(new Message(m.pack()))).to.be.true;
  }
}
