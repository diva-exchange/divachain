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
import { TxMessageStruct } from './tx.js';
import { VoteMessageStruct } from './vote.js';
import { StatusMessageStruct } from './status.js';
import { Wallet } from '../../chain/wallet.js';
export declare const TYPE_TX = 1;
export declare const TYPE_VOTE = 2;
export declare const TYPE_STATUS = 3;
export interface iMessage {
    getOrigin(): string;
    asString(wallet: Wallet): string;
}
export declare class Message {
    protected readonly type: number;
    protected readonly origin: string;
    protected readonly message: TxMessageStruct | VoteMessageStruct | StatusMessageStruct;
    constructor(struct: TxMessageStruct | VoteMessageStruct | StatusMessageStruct, type: number, origin: string);
    getOrigin(): string;
    asString(wallet: Wallet): string;
}
