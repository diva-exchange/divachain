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
import { TransactionStruct } from './transaction';
import { Validation } from '../net/validation';

export type BlockStruct = {
  v: number;
  ph: string;
  h: string;
  tx: Array<TransactionStruct>;
  hght: number;
  vts: Array<{ orgn: string; sig: string }>;
};

export class Block {
  readonly previousBlock: BlockStruct;
  readonly v: number;
  readonly hght: number;
  readonly ph: string;
  readonly h: string;
  readonly tx: Array<TransactionStruct>;

  static make(previousBlock: BlockStruct, tx: Array<TransactionStruct>): BlockStruct {
    const b = new Block(previousBlock, tx).get();
    if (!Validation.validateBlock(b)) {
      throw new Error('Invalid Block');
    }
    return b;
  }

  private constructor(previousBlock: BlockStruct, tx: Array<TransactionStruct>) {
    this.previousBlock = previousBlock;
    this.v = 1; //@FIXME
    this.ph = previousBlock.h;
    this.hght = previousBlock.hght + 1;
    this.tx = tx;
    this.h = Util.hash(this.ph + this.v + this.hght + JSON.stringify(this.tx));
  }

  get(): BlockStruct {
    return {
      v: this.v,
      ph: this.ph,
      h: this.h,
      tx: this.tx,
      hght: this.hght,
      vts: [],
    } as BlockStruct;
  }
}
