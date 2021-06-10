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

export class Validation {
  private static message: ValidateFunction;
  private static tx: ValidateFunction;

  static init() {
    const pathSchema = path.join(__dirname, '../schema/');
    const schemaMessage: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/message.json');
    const schemaAuth: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/auth.json');
    const schemaChallenge: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/challenge.json');
    const schemaVote: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/vote.json');
    const schemaSync: JSONSchemaType<MessageStruct> = require(pathSchema + 'message/sync.json');
    const schemaBlock: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/block.json');
    const schemaVotes: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/votes.json');
    const schemaTx: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/tx.json');
    const schemaAddPeer: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/addPeer.json');
    const schemaRemovePeer: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/removePeer.json');
    const schemaModifyStake: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/modifyStake.json');

    //@TODO
    const schemaTestLoad: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/testLoad.json');

    Validation.message = new Ajv({
      schemas: [
        schemaAuth,
        schemaChallenge,
        schemaVote,
        schemaSync,
        schemaBlock,
        schemaVotes,
        schemaTx,
        schemaAddPeer,
        schemaRemovePeer,
        schemaModifyStake,
        schemaTestLoad,
      ],
    }).compile(schemaMessage);

    Validation.tx = new Ajv({
      schemas: [schemaAddPeer, schemaRemovePeer, schemaModifyStake, schemaTestLoad],
    }).compile(schemaTx);
  }

  static validateMessage(m: Message): boolean {
    if (!Validation.message) {
      Validation.init();
    }

    switch (m.type()) {
      case Message.TYPE_CHALLENGE:
      case Message.TYPE_AUTH:
      case Message.TYPE_VOTE:
      case Message.TYPE_COMMIT:
      case Message.TYPE_CONFIRM:
      case Message.TYPE_SYNC:
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
