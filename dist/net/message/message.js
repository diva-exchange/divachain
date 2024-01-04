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
import { base64url } from 'rfc4648';
export const TYPE_TX = 1;
export const TYPE_VOTE = 2;
export const TYPE_STATUS = 3;
export class Message {
    type;
    origin;
    message;
    constructor(struct, type, origin) {
        this.type = type;
        this.origin = origin;
        this.message = struct;
    }
    getOrigin() {
        return this.origin;
    }
    asString(wallet) {
        const b64 = base64url.stringify(Buffer.from(JSON.stringify(this.message)), { pad: false });
        const pl = [this.type, b64].join(''); // payload
        return wallet.getPublicKey() + wallet.sign(pl) + pl + ';';
    }
}
//# sourceMappingURL=message.js.map