/**
 * Copyright (C) 2021-2024 diva.exchange
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

import Ajv, { ValidateFunction } from 'ajv';

import addPeerV1 from '../schema/tx/v1/add-peer.json' assert { type: 'json' };
import removePeerV1 from '../schema/tx/v1/remove-peer.json' assert { type: 'json' };
import modifyStakeV1 from '../schema/tx/v1/modify-stake.json' assert { type: 'json' };
import dataV1 from '../schema/tx/v1/data.json' assert { type: 'json' };
import votesV1 from '../schema/tx/v1/votes.json' assert { type: 'json' };

import Tx from '../schema/tx/v1/tx.json' assert { type: 'json' };
import Vote from '../schema/message/vote.json' assert { type: 'json' };
import Status from '../schema/message/status.json' assert { type: 'json' };

import { Chain } from '../chain/chain.js';
import { Command, CommandRemovePeer } from '../chain/tx.js';
import { TxMessageStruct } from './message/tx.js';
import { VoteMessageStruct } from './message/vote.js';
import { StatusMessageStruct } from './message/status.js';

export class Validation {
  private readonly Tx: ValidateFunction;
  private readonly Vote: ValidateFunction;
  private readonly Status: ValidateFunction;

  static make(): Validation {
    return new Validation();
  }

  private constructor() {
    this.Tx = new Ajv.default({ strict: true, allErrors: true })
      .addSchema(addPeerV1)
      .addSchema(removePeerV1)
      .addSchema(modifyStakeV1)
      .addSchema(dataV1)
      .addSchema(votesV1)
      .compile(Tx);

    this.Vote = new Ajv.default({ strict: true, allErrors: true }).addSchema(votesV1).compile(Vote);

    this.Status = new Ajv.default({ strict: true, allErrors: true }).compile(Status);
  }

  // stateless && stateful
  //@throws an Exception if Validation fails
  validateTx(struct: TxMessageStruct): void {
    if (!this.Tx(struct)) {
      throw new Error(`validateTx() invalid message ${JSON.stringify(this.Tx.errors)}`);
    }
    this.statefulTx(struct);
  }

  private statefulTx(struct: TxMessageStruct): void {
    // if there are commands available, they must comply with the given rules
    const lc: boolean =
      struct.commands.filter((c: Command): boolean => {
        switch (c.command || '') {
          case Chain.COMMAND_ADD_PEER:
          case Chain.COMMAND_MODIFY_STAKE:
          case Chain.COMMAND_DATA:
            return true;
          case Chain.COMMAND_REMOVE_PEER:
            //@TODO review - forced peer removal by a majority decision gets prevented with this
            // reason: limits the usage of CommandRemovePeer to the tx.origin (only self-removal is possible)
            return struct.origin === (c as CommandRemovePeer).publicKey;
          default:
            return false;
        }
      }).length === struct.commands.length;
    if (!lc) {
      throw new Error(`validateTx() invalid commands #${struct.height}`);
    }

    //@FIXME check the votes
  }

  validateVote(struct: VoteMessageStruct): void {
    if (!this.Vote(struct)) {
      throw new Error(`validateVote invalid message ${JSON.stringify(this.Vote.errors)}`);
    }
  }

  validateStatus(struct: StatusMessageStruct): void {
    if (!this.Status(struct)) {
      throw new Error(`validateStatus invalid message ${JSON.stringify(this.Status.errors)}`);
    }
  }
}
