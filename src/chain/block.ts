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

import { Util } from './util';
import { CommandAddPeer, CommandModifyStake, CommandRemovePeer, TransactionStruct } from './transaction';
import { Logger } from '../logger';

export type BlockStruct = {
  version: number;
  previousHash: string;
  hash: string;
  tx: Array<TransactionStruct>;
  height: number;
  votes: Array<{ origin: string; sig: string }>;
};

export class Block {
  readonly previousBlock: BlockStruct;
  readonly version: number;
  readonly height: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly tx: Array<TransactionStruct>;

  static make(previousBlock: BlockStruct, tx: Array<TransactionStruct>): BlockStruct {
    const b = new Block(previousBlock, tx).get();
    Block.validate(b);
    return b;
  }

  private constructor(previousBlock: BlockStruct, tx: Array<TransactionStruct>) {
    this.previousBlock = previousBlock;
    this.version = 1; //@FIXME
    this.previousHash = previousBlock.hash;
    this.height = previousBlock.height + 1;
    this.tx = tx.sort((a, b) =>
      a.timestamp === b.timestamp ? (a.origin > b.origin ? 1 : -1) : a.timestamp > b.timestamp ? 1 : -1
    );
    this.hash = Util.hash(this.previousHash + this.version + this.height + JSON.stringify(this.tx));
  }

  get(): BlockStruct {
    return {
      version: this.version,
      previousHash: this.previousHash,
      hash: this.hash,
      tx: this.tx,
      height: this.height,
      votes: [],
    } as BlockStruct;
  }

  /**
   * Stateful validation (Protocol implementation)
   *
   * @param {BlockStruct} block - Block to validate
   */
  public static validate(block: BlockStruct) {
    let result = true;
    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case 'addPeer':
            result = block.height === 1 || (c as CommandAddPeer).stake === 0;
            break;
          case 'removePeer':
            result = (c as CommandRemovePeer).publicKey === t.origin;
            break;
          case 'modifyStake':
            result = (c as CommandModifyStake).publicKey !== t.origin;
            break;
        }
        if (!result) {
          throw new Error(`Stateful validation failed (${c.command}): ${block.height}`);
        }
      }
    }

    const _aOrigin: Array<string> = [];
    for (const t of block.tx) {
      if (
        _aOrigin.includes(t.origin) ||
        !Util.verifySignature(t.origin, t.sig, t.ident + t.timestamp + JSON.stringify(t.commands))
      ) {
        //@FIXME logging
        Logger.trace(JSON.stringify(block.tx));
        throw new Error(`Multiple transactions from same origin: ${block.height}`);
      }
      _aOrigin.push(t.origin);
    }
  }
}
