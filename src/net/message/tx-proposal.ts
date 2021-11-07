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

import { Message } from './message';
import { TransactionStruct } from '../../chain/transaction';

export type TxProposalStruct = {
  height: number;
  tx: TransactionStruct;
};

export class TxProposal extends Message {
  constructor(message?: Buffer | string) {
    super(message);
    this.message.type = Message.TYPE_TX_PROPOSAL;
    this.message.broadcast = true;
  }

  create(structTxProposal: TxProposalStruct, retry: number): TxProposal {
    this.message.ident = [this.message.type, retry, structTxProposal.height, structTxProposal.tx.sig].join();
    this.message.data = structTxProposal;
    return this;
  }

  get(): TxProposalStruct {
    return this.message.data as TxProposalStruct;
  }
}
