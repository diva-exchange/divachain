/**
 * Copyright (C) 2022-2024 diva.exchange
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
import { Server } from './server.js';
import { Command } from '../chain/tx.js';
import { TxMessage } from './message/tx.js';
import { VoteMessage } from './message/vote.js';
import { StatusMessage } from './message/status.js';
type recordStack = {
    commands: Array<Command>;
};
export declare class TxFactory {
    private readonly server;
    private readonly config;
    private readonly chain;
    private readonly network;
    private readonly validation;
    private readonly wallet;
    private stackTransaction;
    private mapStatus;
    private ownTx;
    private mapTx;
    static make(server: Server): TxFactory;
    private constructor();
    shutdown(): void;
    stack(commands: Array<Command>): boolean;
    getStack(): Array<recordStack>;
    private createOwnTx;
    processTx(tx: TxMessage): void;
    processVote(vote: VoteMessage): void;
    processStatus(status: StatusMessage): void;
    getStatus(): Array<StatusMessage>;
    private addTx;
    private broadcastTx;
}
export {};
