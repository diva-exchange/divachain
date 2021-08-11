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

import { VoteStruct } from '../net/message/vote';

export class CommitPool {
  private currentHash: string = '';
  private arrayCommits: Array<string> = [];
  private arrayStakes: Array<number> = [];
  public hasQuorum: boolean = false;

  add(structVote: VoteStruct, stake: number, quorum: number): boolean {
    if (structVote.block.hash !== this.currentHash) {
      this.clear();
    } else if (this.hasQuorum || this.arrayCommits.includes(structVote.origin)) {
      // Quorum already reached or double commit
      return false;
    }

    this.currentHash = structVote.block.hash;
    this.arrayCommits.push(structVote.origin);
    this.arrayStakes.push(stake);
    this.hasQuorum = this.arrayStakes.reduce((s, _s) => s + _s, 0) >= quorum;
    return true;
  }

  getAll(): { hash: string; commits: Array<any>; stakes: Array<any> } {
    return { hash: this.currentHash, commits: this.arrayCommits, stakes: this.arrayStakes };
  }

  clear() {
    this.currentHash = '';
    this.arrayCommits = [];
    this.arrayStakes = [];
    this.hasQuorum = false;
  }
}
