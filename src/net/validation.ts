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

export class Validation {
  private static message: ValidateFunction;
  private static tx: ValidateFunction;

  static init() {
    const schemaMessage: JSONSchemaType<MessageStruct> = require('../../schema/message/message.json');
    const schemaAuth: JSONSchemaType<MessageStruct> = require('../../schema/message/auth.json');
    const schemaChallenge: JSONSchemaType<MessageStruct> = require('../../schema/message/challenge.json');
    const schemaProposal: JSONSchemaType<MessageStruct> = require('../../schema/message/proposal.json');
    const schemaVote: JSONSchemaType<MessageStruct> = require('../../schema/message/vote.json');
    const schemaCommit: JSONSchemaType<MessageStruct> = require('../../schema/message/commit.json');
    const schemaBlock: JSONSchemaType<BlockStruct> = require('../../schema/block/block.json');
    const schemaVotes: JSONSchemaType<BlockStruct> = require('../../schema/block/votes.json');
    const schemaTx: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/tx.json');
    const schemaAddPeer: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/addPeer.json');
    const schemaRemovePeer: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/removePeer.json');

    //@TODO
    const schemaTestLoad: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/testLoad.json');

    Validation.message = new Ajv({
      schemas: [
        schemaAuth,
        schemaChallenge,
        schemaProposal,
        schemaVote,
        schemaCommit,
        schemaBlock,
        schemaVotes,
        schemaTx,
        schemaAddPeer,
        schemaRemovePeer,
        schemaTestLoad,
      ],
    }).compile(schemaMessage);

    Validation.tx = new Ajv({
      schemas: [schemaAddPeer, schemaRemovePeer, schemaTestLoad],
    }).compile(schemaTx);
  }

  static validateMessage(m: Message): boolean {
    if (!Validation.message) {
      Validation.init();
    }

    switch (m.type()) {
      case Message.TYPE_CHALLENGE:
      case Message.TYPE_AUTH:
      case Message.TYPE_PROPOSAL:
      case Message.TYPE_VOTE:
      case Message.TYPE_COMMIT:
        if (!Validation.message(m.getMessage())) {
          //@FIXME logging
          Logger.trace(Validation.message.errors as object);
          return false;
        }
        break;
      default:
        Logger.error('Unknown message type');
        return false;
    }
    return true;
  }

  static validateTx(tx: TransactionStruct): boolean {
    if (!Validation.tx) {
      Validation.init();
    }

    if (!Validation.tx(tx)) {
      //@FIXME logging
      Logger.trace(Validation.tx.errors as object);
      return false;
    }
    return true;
  }
}
