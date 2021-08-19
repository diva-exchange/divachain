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
import {
  CommandAddAsset,
  CommandAddOrder,
  CommandDeleteAsset,
  CommandDeleteOrder,
  CommandModifyStake,
  CommandRemovePeer,
  TransactionStruct,
} from '../chain/transaction';
import path from 'path';
import { Util } from '../chain/util';
import { MAX_TRANSACTIONS } from '../pool/transaction-pool';

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
    const schemaAddAsset: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/addAsset.json');
    const schemaDeleteAsset: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/deleteAsset.json');
    const schemaAddOrder: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/addOrder.json');
    const schemaDeleteOrder: JSONSchemaType<BlockStruct> = require(pathSchema + 'block/transaction/deleteOrder.json');

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
        schemaAddAsset,
        schemaDeleteAsset,
        schemaAddOrder,
        schemaDeleteOrder,
      ],
    }).compile(schemaMessage);

    Validation.tx = new Ajv({
      schemas: [
        schemaAddPeer,
        schemaRemovePeer,
        schemaModifyStake,
        schemaTestLoad,
        schemaAddAsset,
        schemaDeleteAsset,
        schemaAddOrder,
        schemaDeleteOrder,
      ],
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

    // Schema validation
    if (!Validation.tx(tx)) {
      //@FIXME logging
      Logger.trace(Validation.tx.errors as object);
      return false;
    }

    // Protocol validation
    let result = true;
    for (const c of tx.commands) {
      switch (c.command) {
        case 'addPeer':
          break;
        case 'removePeer':
          result = (c as CommandRemovePeer).publicKey === tx.origin;
          break;
        case 'modifyStake':
          result = (c as CommandModifyStake).publicKey !== tx.origin;
          break;
        case 'addAsset':
          result = (c as CommandAddAsset).publicKey === tx.origin;
          break;
        case 'deleteAsset':
          result = (c as CommandDeleteAsset).publicKey === tx.origin;
          break;
        case 'addOrder':
          result = (c as CommandAddOrder).publicKey === tx.origin;
          break;
        case 'deleteOrder':
          result = (c as CommandDeleteOrder).publicKey === tx.origin;
          break;
      }
      if (!result) {
        Logger.warn(`Validation.validateTx failed: ${c.seq} - ${c.command}`);
        Logger.trace(tx);
        return false;
      }
    }

    return Util.verifySignature(tx.origin, tx.sig, tx.ident + tx.timestamp + JSON.stringify(tx.commands));
  }

  static validateBlock(block: BlockStruct): boolean {
    if (Util.hash(block.previousHash + block.version + block.height + JSON.stringify(block.tx)) !== block.hash) {
      //@FIXME logging
      Logger.warn('Invalid block hash');
      return false;
    }

    if (block.tx.length > MAX_TRANSACTIONS) {
      //@FIXME logging
      Logger.warn('Invalid block tx length');
      return false;
    }

    const _aOrigin: Array<string> = [];
    for (const tx of block.tx) {
      if (_aOrigin.includes(tx.origin)) {
        //@FIXME logging
        Logger.trace(JSON.stringify(block.tx));
        Logger.warn(`Multiple transactions from same origin: ${block.height}`);
        return false;
      }
      _aOrigin.push(tx.origin);

      if (!Validation.validateTx(tx)) {
        return false;
      }
    }

    return true;
  }
}
