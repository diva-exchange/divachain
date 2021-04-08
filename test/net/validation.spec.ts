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
import { Proposal } from '../../src/net/message/proposal';
import { Blockchain } from '../../src/chain/blockchain';
import { Commit } from '../../src/net/message/commit';
import { Vote } from '../../src/net/message/vote';
import { BlockStruct } from '../../src/chain/block';

@suite
class TestValidation {
  private static wallet: Wallet;
  private validation: Validation = {} as Validation;

  @slow(200)
  static before() {
    TestValidation.wallet = new Wallet('TEST-NODE');
  }

  @slow(100)
  static after() {
    TestValidation.wallet.close();
  }

  @slow(100)
  before() {
    this.validation = new Validation();
  }

  @test
  validateAuth() {
    const m = new Auth().create(TestValidation.wallet.sign('test'));
    expect(this.validation.isValidMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateChallenge() {
    const m = new Challenge().create(nanoid(26));
    expect(this.validation.isValidMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateProposal() {
    const block = Blockchain.genesis();
    const m = new Proposal().create({
      origin: TestValidation.wallet.getPublicKey(),
      block: block,
      sig: TestValidation.wallet.sign(block.hash),
    });
    expect(this.validation.isValidMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateVote() {
    const structBlock = Blockchain.genesis();
    const structVote = {
      origin: TestValidation.wallet.getPublicKey(),
      hash: structBlock.hash,
      sig: TestValidation.wallet.sign(structBlock.hash),
    };
    const m = new Vote().create(structVote);
    expect(this.validation.isValidMessage(new Message(m.pack()))).to.be.true;
  }

  @test
  validateCommit() {
    const structBlock: BlockStruct = Blockchain.genesis();
    const arrayVotes = [
      {
        origin: TestValidation.wallet.getPublicKey(),
        sig: TestValidation.wallet.sign(structBlock.hash),
      },
    ];
    const m = new Commit().create({
      origin: TestValidation.wallet.getPublicKey(),
      block: structBlock,
      votes: arrayVotes,
      sig: TestValidation.wallet.sign(structBlock.hash + JSON.stringify(arrayVotes)),
    });
    expect(this.validation.isValidMessage(new Message(m.pack()))).to.be.true;
  }
}
