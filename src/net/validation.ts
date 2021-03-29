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
import { Logger } from '../logger';
import { BlockStruct } from '../chain/block';

export class Validation {
  private readonly ajvBlock: ValidateFunction;
  private readonly ajvMessage: ValidateFunction;

  constructor() {
    const schemaVotes: JSONSchemaType<BlockStruct> = require('../../schema/block/votes.json');
    const schemaTransactions: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/transactions.json');
    const schemaAddPeer: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/addPeer.json');
    const schemaRemovePeer: JSONSchemaType<BlockStruct> = require('../../schema/block/transaction/removePeer.json');
    const schemaBlock: JSONSchemaType<BlockStruct> = require('../../schema/block/block.json');
    this.ajvBlock = new Ajv({
      schemas: [schemaVotes, schemaTransactions, schemaAddPeer, schemaRemovePeer],
    }).compile(schemaBlock);

    const schemaAck: JSONSchemaType<MessageStruct> = require('../../schema/message/ack.json');
    const schemaAuth: JSONSchemaType<MessageStruct> = require('../../schema/message/auth.json');
    const schemaChallenge: JSONSchemaType<MessageStruct> = require('../../schema/message/challenge.json');
    const schemaMessage: JSONSchemaType<MessageStruct> = require('../../schema/message/message.json');

    this.ajvMessage = new Ajv({
      schemas: [schemaAck, schemaAuth, schemaChallenge],
    }).compile(schemaMessage);
  }

  // stateless validation
  isValid(m: Message): boolean {
    switch (m.type()) {
      case Message.TYPE_CHALLENGE:
      case Message.TYPE_AUTH:
      case Message.TYPE_TRANSACTION:
      case Message.TYPE_PROPOSAL:
      case Message.TYPE_VOTE:
      case Message.TYPE_COMMIT:
      case Message.TYPE_ACK:
        if (!this.ajvMessage(m.getMessage())) {
          //@FIXME logging
          console.log(this.ajvMessage.errors);
          Logger.trace(this.ajvMessage.errors as object);
          return false;
        }
        return true;
      default:
        return false;
    }
  }
}
