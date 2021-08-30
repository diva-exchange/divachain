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

export class VotePool {
  private currentHash: string = '';
  private countTx: number = 0;
  private sortTx: string = '';
  private arrayOrigins: Array<string> = [];
  private arrayVotes: Array<{ orgn: string; sig: string }> = [];
  private arrayStakes: Array<number> = [];
  public hasQuorum: boolean = false;

  add(structVote: VoteStruct, stake: number, quorum: number): boolean {
    if (this.currentHash === structVote.blc.h && this.arrayOrigins.includes(structVote.orgn)) {
      // double vote
      return false;
    } else if (this.currentHash !== structVote.blc.h) {
      // check for better Tx
      const newSortTx = structVote.blc.tx.map((_tx) => _tx.sig).join('');
      if (
        this.countTx > structVote.blc.tx.length ||
        (this.countTx === structVote.blc.tx.length && newSortTx > this.sortTx)
      ) {
        return false;
      }

      this.clear();
      this.currentHash = structVote.blc.h;
      this.countTx = structVote.blc.tx.length;
      this.sortTx = newSortTx;
    }

    this.arrayOrigins.push(structVote.orgn);
    this.arrayVotes.push({ orgn: structVote.orgn, sig: structVote.sig });
    this.arrayStakes.push(stake);
    this.hasQuorum = this.arrayStakes.reduce((s, _s) => s + _s, 0) >= quorum;
    return true;
  }

  get(): Array<{ orgn: string; sig: string }> {
    return this.arrayVotes;
  }

  getAll(): { hash: string; votes: Array<{ orgn: string; sig: string }>; stakes: Array<number>; hasQuorum: boolean } {
    return { hash: this.currentHash, votes: this.arrayVotes, stakes: this.arrayStakes, hasQuorum: this.hasQuorum };
  }

  clear() {
    this.currentHash = '';
    this.countTx = 0;
    this.sortTx = '';
    this.arrayOrigins = [];
    this.arrayVotes = [];
    this.arrayStakes = [];
    this.hasQuorum = false;
  }
}
