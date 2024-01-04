/**
 * Copyright (C) 2021-2024 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */
import { Message, TYPE_VOTE } from './message.js';
export class VoteMessage extends Message {
    constructor(struct, pkOrigin) {
        super(struct, TYPE_VOTE, pkOrigin);
    }
    hash() {
        return this.message.hash;
    }
    votes() {
        return this.message.votes;
    }
}
//# sourceMappingURL=vote.js.map