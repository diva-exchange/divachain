/**
 * Copyright (C) 2021-2026 diva.exchange
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

import Ajv, { ValidateFunction } from 'ajv';

import dataV1 from '../schema/tx/v1/data.json' with { type: 'json' };

import Tx from '../schema/tx/v1/tx.json' with { type: 'json' };
import Status from '../schema/message/status.json' with { type: 'json' };
import AddPeer from '../schema/message/add-peer.json' with { type: 'json' };
import RemovePeer from '../schema/message/remove-peer.json' with {
  type: 'json',
};

import { Command, COMMAND_DATA } from '../chain/tx.ts';
import { TxMessageStruct } from './message/tx.ts';
import { StatusMessageStruct } from './message/status.ts';
import { AddPeerMessageStruct } from './message/add-peer.ts';
import { RemovePeerMessageStruct } from './message/remove-peer.ts';
import { Util } from '../chain/util.ts';

export class Validation {
  private readonly Tx: ValidateFunction;
  private readonly Status: ValidateFunction;
  private readonly AddPeer: ValidateFunction;
  private readonly RemovePeer: ValidateFunction;

  static make(): Validation {
    const v: Validation = new Validation();
    return v;
  }

  private constructor() {
    this.Tx = new Ajv.default({ strict: true, allErrors: true })
      .addSchema(dataV1)
      .compile(Tx);

    this.Status = new Ajv.default({ strict: true, allErrors: true }).compile(
      Status,
    );
    this.AddPeer = new Ajv.default({ strict: true, allErrors: true }).compile(
      AddPeer,
    );
    this.RemovePeer = new Ajv.default({ strict: true, allErrors: true })
      .compile(
        RemovePeer,
      );
  }

  // stateless && stateful
  //@throws an Exception if Validation fails
  public validateTx(struct: TxMessageStruct): void {
    if (!this.Tx(struct)) {
      throw new Error(
        `validateTx() invalid message ${JSON.stringify(this.Tx.errors)}`,
      );
    }

    // if there are commands available, they must comply with the given rules
    const lc: boolean = struct.cs.filter((c: Command): boolean => {
      switch (c.c) {
        case COMMAND_DATA:
          return true;
        default:
          return false;
      }
    }).length === struct.cs.length;
    if (!lc) {
      throw new Error(`validateTx() invalid commands #${struct.h}`);
    }

    // check hash
    if (struct.ha !== Util.hash(struct)) {
      throw new Error(`validateTx() invalid hash #${struct.h}`);
    }
  }

  public validateStatus(struct: StatusMessageStruct): void {
    if (!this.Status(struct)) {
      throw new Error(
        `validateStatus invalid message ${JSON.stringify(this.Status.errors)}`,
      );
    }

    // check timestamp
    const refT: number = Date.now();
    const dev: number = 60 * 1000; // 1 minute in ms
    if (struct.t < refT - dev || struct.t > refT + dev) {
      throw new Error(
        `validateStatus timestamp out of range: ${refT} != ${struct.t} +/-${dev}ms`,
      );
    }
  }

  public validateAddPeer(struct: AddPeerMessageStruct): void {
    if (!this.AddPeer(struct)) {
      throw new Error(
        `validateAddPeer invalid message ${
          JSON.stringify(this.AddPeer.errors)
        }`,
      );
    }
  }

  public validateRemovePeer(struct: RemovePeerMessageStruct): void {
    if (!this.RemovePeer(struct)) {
      throw new Error(
        `validateRemovePeer invalid message ${
          JSON.stringify(this.RemovePeer.errors)
        }`,
      );
    }
  }
}
