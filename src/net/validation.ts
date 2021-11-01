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
import { Block, BlockStruct } from '../chain/block';
import { Logger } from '../logger';
import { TransactionStruct } from '../chain/transaction';
import path from 'path';
import { Util } from '../chain/util';
import { Blockchain } from '../chain/blockchain';

export class Validation {
  private static message: ValidateFunction;
  private static tx: ValidateFunction;

  private static isInitialized: Boolean = false;

  static init() {
    const pathSchema = path.join(__dirname, '../schema/');
    const schemaMessage: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/message.json');
    const schemaAuth: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/auth.json');
    const schemaChallenge: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/challenge.json');
    const schemaTxProposal: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/tx-proposal.json');
    const schemaVote: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/vote.json');
    const schemaSync: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/sync.json');
    const schemaBlock: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/block.json');
    const schemaVotes: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/votes.json');
    const schemaTx: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/tx.json');
    const schemaAddPeer: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/add-peer.json');
    const schemaRemovePeer: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/remove-peer.json');
    const schemaModifyStake: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/modify-stake.json');
    const schemaDataDecision: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/transaction/data-decision.json');

    Validation.message = new Ajv({
      schemas: [
        schemaAuth,
        schemaChallenge,
        schemaTxProposal,
        schemaVote,
        schemaSync,
        schemaBlock,
        schemaVotes,
        schemaTx,
        schemaAddPeer,
        schemaRemovePeer,
        schemaModifyStake,
        schemaDataDecision,
      ],
    }).compile(schemaMessage);

    Validation.tx = new Ajv({
      schemas: [schemaAddPeer, schemaRemovePeer, schemaModifyStake, schemaDataDecision],
    }).compile(schemaTx);

    Validation.isInitialized = true;
  }

  static validateMessage(m: Message): boolean {
    if (!Validation.isInitialized) {
      Validation.init();
    }

    switch (m.type()) {
      case Message.TYPE_AUTH:
      case Message.TYPE_CHALLENGE:
      case Message.TYPE_TX_PROPOSAL:
      case Message.TYPE_LOCK:
      case Message.TYPE_VOTE:
      case Message.TYPE_SYNC:
        if (!Validation.message(m.getMessage())) {
          Logger.trace(JSON.stringify(Validation.message.errors));
          return false;
        }
        return true;
      default:
        Logger.trace('Unknown message type');
        return false;
    }
  }

  static validateBlock(structBlock: BlockStruct): boolean {
    const { hash, height, tx, votes } = structBlock;

    let _aOrigin: Array<string>;

    // vote validation
    _aOrigin = [];
    for (const vote of votes) {
      if (_aOrigin.includes(vote.origin)) {
        Logger.trace(`Validation.validateBlock() - Multiple votes from same origin: ${height}`);
        return false;
      }
      _aOrigin.push(vote.origin);

      if (!Util.verifySignature(vote.origin, vote.sig, hash)) {
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

      if (!Validation.validateTx(height, transaction)) {
        Logger.trace(`Validation.validateBlock() - invalid tx: ${height}`);
        return false;
      }
    }

    return Block.validateHash(structBlock);
  }

  static validateTx(height: number, tx: TransactionStruct): boolean {
    if (!Validation.isInitialized) {
      Validation.init();
    }

    // Signature and Schema validation
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
            if (!Validation.tx(tx)) {
              Logger.trace(JSON.stringify(Validation.tx.errors));
              return false;
            }
            return true;
          default:
            return false;
        }
      }).length === tx.commands.length
    );
  }
}
