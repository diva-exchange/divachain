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

import { BlockStruct } from '../chain/block';
import { VoteStruct } from '../net/message/vote';

export class CommitPool {
  private mapVotes: Map<string, Array<string>> = new Map(); // votes holding hashes and origins
  private mapCommits: Map<string, VoteStruct> = new Map();

  add(c: VoteStruct): boolean {
    const aVotes = this.mapVotes.get(c.block.hash) || [];
    if (aVotes.includes(c.origin)) {
      return false;
    }
    aVotes.push(c.origin);
    this.mapVotes.set(c.block.hash, aVotes);
    this.mapCommits.set(c.block.hash, c);
    return true;
  }

  best(): BlockStruct {
    if (!this.mapCommits.size) {
      return {} as BlockStruct;
    }
    const a = Array.from(this.mapCommits.values());
    a.sort((a, b) => {
      return a.block.height > b.block.height
        ? 1
        : a.block.height < b.block.height
        ? -1
        : a.block.tx.length > b.block.tx.length
        ? -1
        : 1;
    });

    return a[0].block;
  }

  accepted(quorum: number): BlockStruct | false {
    const block = this.best();
    return (this.mapVotes.get(block.hash) || []).length >= quorum ? block : false;
  }

  get(): object {
    return { mapCommits: [...this.mapCommits.entries()], mapVotes: [...this.mapVotes.entries()] };
  }

  clear(block: BlockStruct) {
    this.mapCommits.forEach((c, h) => {
      if (c.block.height <= block.height) {
        this.mapVotes.delete(h);
        this.mapCommits.delete(h);
      }
    });
  }
}
