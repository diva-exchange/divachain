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
import { TxMessageStruct } from './message/tx.js';
import { VoteMessageStruct } from './message/vote.js';
import { StatusMessageStruct } from './message/status.js';
export declare class Validation {
    private readonly Tx;
    private readonly Vote;
    private readonly Status;
    static make(): Validation;
    private constructor();
    validateTx(struct: TxMessageStruct): void;
    private statefulTx;
    validateVote(struct: VoteMessageStruct): void;
    validateStatus(struct: StatusMessageStruct): void;
}