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
import { Util } from '../../chain/util';
import { TransactionStruct } from '../../chain/transaction';

export type ProposalStruct = {
  type: number;
  origin: string;
  height: number;
  tx: TransactionStruct;
  sig: string;
};

export class Proposal extends Message {
  create(origin: string, height: number, tx: TransactionStruct, sig: string): Proposal {
    const structProposal: ProposalStruct = {
      type: Message.TYPE_PROPOSAL,
      origin: origin,
      height: height,
      tx: tx,
      sig: sig,
    };
    this.message.ident = [structProposal.type, sig].join();
    this.message.data = structProposal;
    return this;
  }

  get(): ProposalStruct {
    return this.message.data as ProposalStruct;
  }

  // stateful
  static isValid(structProposal: ProposalStruct): boolean {
    return Util.verifySignature(
      structProposal.origin,
      structProposal.sig,
      Util.hash([structProposal.height, JSON.stringify(structProposal.tx)].join())
    );
  }
}
