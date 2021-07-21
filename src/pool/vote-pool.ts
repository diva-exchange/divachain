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
  private arrayVotes: Array<{ origin: string; sig: string }> = [];
  private arrayStakes: Array<number> = [];

  add(structVote: VoteStruct, stake: number, quorum: number): boolean {
    let isRelevant = this.currentHash === structVote.block.hash || this.countTx < structVote.block.tx.length;
    if (isRelevant) {
      if (this.currentHash !== structVote.block.hash) {
        this.currentHash = structVote.block.hash;
        this.countTx = structVote.block.tx.length;
        this.arrayVotes = [];
        this.arrayStakes = [];
      }
      isRelevant = !this.arrayVotes.some((v) => structVote.origin === v.origin);
      if (isRelevant) {
        this.arrayVotes.push({ origin: structVote.origin, sig: structVote.sig });
        this.arrayStakes.push(stake);
      }
    }

    return isRelevant && this.arrayStakes.reduce((s, _s) => s + _s, 0) >= quorum;
  }

  get(): Array<{ origin: string; sig: string }> {
    return this.arrayVotes;
  }

  getAll(): { hash: string; votes: Array<any>; stakes: Array<any> } {
    return { hash: this.currentHash, votes: this.arrayVotes, stakes: this.arrayStakes };
  }

  clear() {
    this.currentHash = '';
    this.countTx = 0;
    this.arrayVotes = [];
    this.arrayStakes = [];
  }
}
