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

import { Block } from '../blockchain/block';

export class BlockPool {
  private list: Array<Block>;

  constructor() {
    this.list = [];
  }

  exists(block: Block): boolean {
    return !!this.list.find((b) => b.hash === block.hash);
  }

  add(block: Block): void {
    this.list.push(block);
  }

  getBlock(hash: string): Block {
    const b = this.list.find((b) => b.hash === hash);
    if (!b) {
      throw new Error(`Block ${hash} not found`);
    }
    return b;
  }
}
