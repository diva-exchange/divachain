/**
 * Copyright (C) 2021-2022 diva.exchange
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

import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import { Message, MessageStruct } from './message/message';
import { BlockStruct } from '../chain/block';
import { Logger } from '../logger';
import { CommandDecision, TransactionStruct } from '../chain/transaction';
import path from 'path';
import { Util } from '../chain/util';
import { Blockchain } from '../chain/blockchain';
import { Server } from './server';
import { MAX_NETWORK_SIZE } from '../config';

export class Validation {
  private readonly server: Server;
  private readonly message: ValidateFunction;
  private readonly tx: ValidateFunction;

  static make(server: Server) {
    return new Validation(server);
  }

  private constructor(server: Server) {
    this.server = server;
    const pathSchema = path.join(__dirname, '../schema/');

    const schemaMessage: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/message.json');
    const schemaAddTx: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/add-tx.json');
    const schemaProposeBlock: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/propose-block.json');
    const schemaSignBlock: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/sign-block.json');
    const schemaConfirmBlock: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/confirm-block.json');
    const schemaStatus: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/status.json');

    const schemaBlockv7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/block.json');
    const schemaTxv7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/transaction/tx.json');
    const schemaVotev7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/vote.json');
    const schemaAddPeerv7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/transaction/add-peer.json');
    const schemaRemovePeerv7: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v7/transaction/remove-peer.json');
    const schemaModifyStakev7: JSONSchemaType<BlockStruct> = require(pathSchema +
      'block/v7/transaction/modify-stake.json');
    const schemaDatav7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/transaction/data.json');
    const schemaDecisionv7: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/v7/transaction/decision.json');

    this.message = new Ajv({
      schemas: [
        schemaAddTx,
        schemaProposeBlock,
        schemaSignBlock,
        schemaConfirmBlock,
        schemaStatus,
        schemaBlockv7,
        schemaTxv7,
        schemaVotev7,
        schemaAddPeerv7,
        schemaRemovePeerv7,
        schemaModifyStakev7,
        schemaDatav7,
        schemaDecisionv7,
      ],
    }).compile(schemaMessage);

    this.tx = new Ajv({
      schemas: [schemaAddPeerv7, schemaRemovePeerv7, schemaModifyStakev7, schemaDatav7, schemaDecisionv7],
    }).compile(schemaTxv7);
  }

  // stateless
  validateMessage(m: Message): boolean {
    switch (m.type()) {
      case Message.TYPE_ADD_TX:
      case Message.TYPE_PROPOSE_BLOCK:
      case Message.TYPE_SIGN_BLOCK:
      case Message.TYPE_CONFIRM_BLOCK:
      case Message.TYPE_STATUS:
        if (!this.message(m.getMessage())) {
          Logger.trace('Validation.validateMessage() failed');
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
  validateBlock(structBlock: BlockStruct, doVoteValidation: boolean = true): boolean {
    const { version, previousHash, hash, height, tx, votes } = structBlock;

    if (!tx.length) {
      Logger.trace(`Validation.validateBlock() - empty tx, block #${height}`);
      return false;
    }
    if (Util.hash([version, previousHash, JSON.stringify(tx), height].join()) !== hash) {
      Logger.trace(`Validation.validateBlock() - invalid hash, block #${height}`);
      return false;
    }

    let _aOrigin: Array<string> = [];

    // vote validation
    if (doVoteValidation) {
      if (votes.length < this.server.getBlockchain().getQuorum()) {
        Logger.trace(`Validation.validateBlock() - not enough votes, block #${height}`);
        return false;
      }
      for (const vote of votes) {
        if (_aOrigin.includes(vote.origin)) {
          Logger.trace(`Validation.validateBlock() - Multiple votes from same origin, block #${height}`);
          return false;
        }
        _aOrigin.push(vote.origin);

        if (!Util.verifySignature(vote.origin, vote.sig, hash)) {
          Logger.trace(`Validation.validateBlock() - invalid vote, block #${height}, origin ${vote.origin}`);
          return false;
        }
      }
    }

    // transaction validation
    _aOrigin = [];
    for (const transaction of tx) {
      if (_aOrigin.includes(transaction.origin)) {
        Logger.trace(`Validation.validateBlock() - Multiple transactions from same origin, block #${height}`);
        return false;
      }
      _aOrigin.push(transaction.origin);

      if (!this.validateTx(height, transaction)) {
        Logger.trace(`Validation.validateBlock() - invalid tx, block #${height}, tx #${transaction.ident}`);
        return false;
      }
    }

    return true;
  }

  // stateless && stateful
  validateTx(height: number, tx: TransactionStruct): boolean {
    return (
      this.tx(tx) &&
      height > 0 &&
      Array.isArray(tx.commands) &&
      Util.verifySignature(tx.origin, tx.sig, height + JSON.stringify(tx.commands)) &&
      tx.commands.filter((c) => {
        switch (c.command || '') {
          case Blockchain.COMMAND_ADD_PEER:
            // respect maximum network size
            return this.server.getBlockchain().getMapPeer().size < MAX_NETWORK_SIZE;
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
