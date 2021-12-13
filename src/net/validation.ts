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

import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import { Message, MessageStruct } from './message/message';
import { BlockStruct } from '../chain/block';
import { Logger } from '../logger';
import { TransactionStruct } from '../chain/transaction';
import path from 'path';
import { Util } from '../chain/util';
import { Blockchain } from '../chain/blockchain';

export class Validation {
  private readonly message: ValidateFunction;

  static make() {
    return new Validation();
  }

  private constructor() {
    const pathSchema = path.join(__dirname, '../schema/');

    const schemaMessage: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/message.json');
    const schemaProposal: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/proposal.json');
    const schemaVote: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/vote.json');

    const schemaBlockV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/block.json');
    const schemaVotesV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/votes.json');
    const schemaTxV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/transaction/tx.json');
    const schemaAddPeerV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/transaction/add-peer.json');
    const schemaRemovePeerV1: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v1/transaction/remove-peer.json');
    const schemaModifyStakeV1: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v1/transaction/modify-stake.json');
    const schemaDataV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/transaction/data.json');
    const schemaDecisionV1: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v1/transaction/decision.json');

    const schemaBlockV2: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v2/block.json');
    const schemaVotesV2: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v2/votes.json');
    const schemaTxV2: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v2/transaction/tx.json');
    const schemaAddPeerV2: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v2/transaction/add-peer.json');
    const schemaRemovePeerV2: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v2/transaction/remove-peer.json');
    const schemaModifyStakeV2: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v2/transaction/modify-stake.json');
    const schemaDataDecisionV2: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v2/transaction/data-decision.json');

    const schemaBlockV3: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v3/block.json');
    const schemaVotesV3: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v3/votes.json');
    const schemaTxV3: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v3/transaction/tx.json');
    const schemaAddPeerV3: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v3/transaction/add-peer.json');
    const schemaRemovePeerV3: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v3/transaction/remove-peer.json');
    const schemaModifyStakeV3: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v3/transaction/modify-stake.json');
    const schemaDataDecisionV3: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v3/transaction/data-decision.json');

    this.message = new Ajv({
      schemas: [
        schemaProposal,
        schemaVote,
        schemaBlockV1,
        schemaVotesV1,
        schemaTxV1,
        schemaAddPeerV1,
        schemaRemovePeerV1,
        schemaModifyStakeV1,
        schemaDataV1,
        schemaDecisionV1,
        schemaBlockV2,
        schemaVotesV2,
        schemaTxV2,
        schemaAddPeerV2,
        schemaRemovePeerV2,
        schemaModifyStakeV2,
        schemaDataDecisionV2,
        schemaBlockV3,
        schemaVotesV3,
        schemaTxV3,
        schemaAddPeerV3,
        schemaRemovePeerV3,
        schemaModifyStakeV3,
        schemaDataDecisionV3,
      ],
    }).compile(schemaMessage);
  }

  // stateless
  validateMessage(m: Message): boolean {
    switch (m.type()) {
      case Message.TYPE_PROPOSAL:
      case Message.TYPE_VOTE:
        if (!this.message(m.getMessage())) {
          Logger.trace('Validation.validateMessage() failed');
          Logger.trace(`${JSON.stringify(m)}`);
          Logger.trace(`${JSON.stringify(this.message.errors)}`);
          return false;
        }
        return true;
      default:
        Logger.trace('Unknown message type');
        return false;
    }
  }

  // stateful
  validateBlock(structBlock: BlockStruct): boolean {
    const { version, previousHash, hash, height, tx, votes } = structBlock;

    let _aOrigin: Array<string>;

    // vote validation
    _aOrigin = [];
    const voteHash = Util.hash([height, Util.hash(JSON.stringify(tx))].join());
    for (const vote of votes) {
      if (_aOrigin.includes(vote.origin)) {
        Logger.trace(`Validation.validateBlock() - Multiple votes from same origin: ${height}`);
        return false;
      }
      _aOrigin.push(vote.origin);

      if (!Util.verifySignature(vote.origin, vote.sig, voteHash)) {
        Logger.trace(`Validation.validateBlock() - invalid vote: ${height}`);
        return false;
      }
    }

    // transaction validation
    _aOrigin = [];
    for (const transaction of tx) {
      if (_aOrigin.includes(transaction.origin)) {
        Logger.trace(`Validation.validateBlock() - Multiple transactions from same origin: ${height}`);
        return false;
      }
      _aOrigin.push(transaction.origin);

      if (!this.validateTx(height, transaction)) {
        Logger.trace(`Validation.validateBlock() - invalid tx: ${height}`);
        return false;
      }
    }

    return Util.hash(previousHash + version + height + JSON.stringify(tx)) === hash;
  }

  // stateful
  validateTx(height: number, tx: TransactionStruct): boolean {
    return (
      Array.isArray(tx.commands) &&
      Util.verifySignature(tx.origin, tx.sig, height + JSON.stringify(tx.commands)) &&
      tx.commands.filter((c) => {
        switch (c.command || '') {
          case Blockchain.COMMAND_ADD_PEER:
          case Blockchain.COMMAND_REMOVE_PEER:
          case Blockchain.COMMAND_MODIFY_STAKE:
          case Blockchain.COMMAND_DATA:
          case Blockchain.COMMAND_DECISION:
            return true;
          default:
            return false;
        }
      }).length === tx.commands.length
    );
  }
}
