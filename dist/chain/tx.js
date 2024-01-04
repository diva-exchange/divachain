/**
 * Copyright (C) 2024 diva.exchange
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
import { TX_VERSION } from '../config.js';
import { Util } from './util.js';
export class Tx {
    prevTx;
    v;
    height;
    origin;
    prev;
    hash;
    commands;
    votes;
    constructor(wallet, prevTx, commands) {
        this.prevTx = prevTx;
        this.v = TX_VERSION;
        this.height = prevTx.height + 1;
        this.origin = wallet.getPublicKey();
        this.prev = prevTx.hash;
        this.commands = commands;
        this.hash = Util.hash({
            v: TX_VERSION,
            height: prevTx.height + 1,
            origin: wallet.getPublicKey(),
            prev: prevTx.hash,
            hash: '',
            commands: commands,
            votes: [],
        });
        this.votes = [{ origin: this.origin, sig: wallet.sign(this.hash) }];
    }
    get() {
        return {
            v: this.v,
            height: this.height,
            origin: this.origin,
            prev: this.prev,
            hash: this.hash,
            commands: this.commands,
            votes: this.votes,
        };
    }
}
//# sourceMappingURL=tx.js.map