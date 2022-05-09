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
import { CommandDecision, TransactionStruct } from '../chain/transaction';
import path from 'path';
import { Util } from '../chain/util';
import { Blockchain } from '../chain/blockchain';
import { Server } from './server';

export class Validation {
  private readonly server: Server;
  private readonly message: ValidateFunction;

  static make(server: Server) {
    return new Validation(server);
  }

  private constructor(server: Server) {
    this.server = server;
    const pathSchema = path.join(__dirname, '../schema/');

    const schemaMessage: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/message.json');
    const schemaProposal: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/proposal.json');
    const schemaVote: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/vote.json');

    const schemaBlockV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/block.json');
    const schemaVotesV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/votes.json');
    const schemaTxV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/transaction/tx.json');
    const schemaAddPeerV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/transaction/add-peer.json');
    const schemaRemovePeerV5: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v5/transaction/remove-peer.json');
    const schemaModifyStakeV5: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v5/transaction/modify-stake.json');
    const schemaDataV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/transaction/data.json');
    const schemaDecisionV5: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v5/transaction/decision.json');

    this.message = new Ajv({
      schemas: [
        schemaProposal,
        schemaVote,
        schemaBlockV5,
        schemaVotesV5,
        schemaTxV5,
        schemaAddPeerV5,
        schemaRemovePeerV5,
        schemaModifyStakeV5,
        schemaDataV5,
        schemaDecisionV5,
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

    if (!tx.length || !votes.length) {
      Logger.trace(`Validation.validateBlock() - empty tx or votes: ${height}`);
      return false;
    }

    // vote validation
    _aOrigin = [];
    const voteHash = [height, Util.hash(JSON.stringify(tx))].join();
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
      height > 0 &&
      Array.isArray(tx.commands) &&
      Util.verifySignature(tx.origin, tx.sig, height + JSON.stringify(tx.commands)) &&
      tx.commands.filter((c) => {
        switch (c.command || '') {
          case Blockchain.COMMAND_ADD_PEER:
          case Blockchain.COMMAND_REMOVE_PEER:
          case Blockchain.COMMAND_MODIFY_STAKE:
          case Blockchain.COMMAND_DATA:
            return true;
          case Blockchain.COMMAND_DECISION:
            return (
              (c as CommandDecision).h >= height && !this.server.getBlockchain().isDecisionTaken(c as CommandDecision)
            );
          default:
            return false;
        }
      }).length === tx.commands.length
    );
  }
}
