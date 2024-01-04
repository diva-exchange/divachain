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
import { Wallet } from '../chain/wallet.js';
import { Command, Tx, TxStruct, VoteStruct } from '../chain/tx.js';
import { Chain } from '../chain/chain.js';
import { Validation } from './validation.js';
import { TxMessage } from './message/tx.js';
import { VoteMessage, VoteMessageStruct } from './message/vote.js';
import { StatusMessage } from './message/status.js';
import { Logger } from '../logger.js';
import { Config } from '../config.js';
import { Network } from './network.js';
import { Util } from '../chain/util.js';

type recordStack = {
  commands: Array<Command>;
};

export class TxFactory {
  private readonly server: Server;
  private readonly config: Config;
  private readonly chain: Chain;
  private readonly network: Network;
  private readonly validation: Validation;
  private readonly wallet: Wallet;

  private stackTransaction: Array<recordStack> = [];

  private ownTx: TxStruct = {} as TxStruct;
  private mapTx: Map<string, TxStruct> = new Map(); // hash -> TxStruct

  static make(server: Server): TxFactory {
    return new TxFactory(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.config = server.config;
    this.chain = server.getChain();
    this.network = server.getNetwork();
    this.validation = server.getValidation();
    this.wallet = server.getWallet();
  }

  shutdown(): void {
    //@TODO cleanup
  }

  stack(commands: Array<Command>): boolean {
    if (this.stackTransaction.push({ commands: commands })) {
      this.createOwnTx();
      return true;
    }
    return false;
  }

  private createOwnTx(): void {
    const me: string = this.wallet.getPublicKey();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(me);

    if (this.ownTx.height || !this.stackTransaction.length || !prevTx) {
      return;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    this.ownTx = new Tx(this.wallet, prevTx, r.commands).get();
    this.mapTx.set(this.ownTx.hash, this.ownTx);

    // broadcast ownTx
    this.broadcastTx(this.ownTx);

    //@FIXME logging
    Logger.trace(`${this.config.port}: TX created on ${me} #${this.chain.getListPeer().indexOf(me)}`);
  }

  processTx(tx: TxMessage): void {
    const structTx: TxStruct = tx.tx();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(structTx.origin);

    // not interested
    if (!prevTx || prevTx.height + 1 !== structTx.height || prevTx.hash !== structTx.prev) {
      return;
    }

    // check hash
    if (structTx.hash !== Util.hash(structTx)) {
      //@FIXME serious breach
      Logger.trace(`${this.config.port}: TX invalid hash`);
      return;
    }
    // check existing vote from origin
    if (
      !structTx.votes.some((v: VoteStruct): boolean => {
        return v.origin === structTx.origin;
      })
    ) {
      //@FIXME serious breach
      Logger.trace(`${this.config.port}: TX missing vote from origin`);
      return;
    }
    // check all votes (signatures)
    if (
      !structTx.votes.every((v: VoteStruct): boolean => {
        return Util.verifySignature(v.origin, v.sig, structTx.hash);
      })
    ) {
      //@FIXME serious breach
      Logger.trace(`${this.config.port}: TX invalid votes`);
      return;
    }

    //@TODO stateful? Reason to add own vote?
    const me: string = this.wallet.getPublicKey();
    if (
      !structTx.votes.some((v: VoteStruct): boolean => {
        return v.origin === me;
      })
    ) {
      structTx.votes = structTx.votes.concat({ origin: me, sig: this.wallet.sign(structTx.hash) });
      this.mapTx.set(structTx.hash, structTx);

      // new valid tx?
      if (this.chain.hasQuorum(structTx.votes.length)) {
        (async (): Promise<void> => {
          await this.addTx(structTx);
        })();
      } else {
        const struct: VoteMessageStruct = { hash: structTx.hash, votes: structTx.votes };
        this.network.broadcast(new VoteMessage(struct, me).asString(this.wallet));
      }
    }
  }

  processVote(vote: VoteMessage): void {
    const structTx: TxStruct | undefined = this.mapTx.get(vote.hash());

    // not interested
    if (!structTx) {
      return;
    }

    // new votes?
    const aV: Array<VoteStruct> = vote.votes().filter((v: VoteStruct): boolean => {
      return (
        !structTx.votes.some((vO: VoteStruct): boolean => {
          return vO.origin === v.origin;
        }) && Util.verifySignature(v.origin, v.sig, structTx.hash)
      );
    });
    if (!aV.length) {
      return;
    }

    structTx.votes = structTx.votes.concat(aV);
    this.mapTx.set(vote.hash(), structTx);

    // new valid tx?
    if (this.chain.hasQuorum(structTx.votes.length)) {
      (async (): Promise<void> => {
        await this.addTx(structTx);
      })();
    } else {
      const me: string = this.wallet.getPublicKey();
      const struct: VoteMessageStruct = { hash: structTx.hash, votes: structTx.votes };
      this.network.broadcast(new VoteMessage(struct, me).asString(this.wallet));
    }
  }

  processStatus(status: StatusMessage): void {
    const me: string = this.wallet.getPublicKey();
    (async (): Promise<void> => {
      for await (const r of status.matrix()) {
        let height: number = this.chain.getHeight(r.origin) || 0;
        //@TODO hardcoded limit of 5 txs
        height = height > r.height + 5 ? r.height + 5 : height;
        for (let h = r.height + 1; h <= height; h++) {
          const structTx: TxStruct | undefined = await this.chain.getTx(h, r.origin);
          structTx && this.broadcastTx(structTx, status.getOrigin());
        }

        // resend ownTx
        r.origin === me && r.height + 1 === this.ownTx.height && this.broadcastTx(this.ownTx, status.getOrigin());
      }
    })();
  }

  private async addTx(structTx: TxStruct): Promise<void> {
    //@FIXME logging
    Logger.trace(`${this.config.port}: NEW TX stored locally #${structTx.height} from ${structTx.origin}`);

    try {
      await this.chain.add(structTx);
    } catch (error) {
      Logger.warn(`${this.config.port}: addTx failed, ${error}`);
      return;
    }

    if (this.ownTx.hash === structTx.hash) {
      this.ownTx = {} as TxStruct;
    }
    this.mapTx.delete(structTx.hash);

    // push the tx to the queue of the feed (websocket)
    this.server.queueWebSocketFeed(structTx);

    // broadcast complete Tx
    this.broadcastTx(structTx);

    // create a new TxMessage
    this.createOwnTx();
  }

  private broadcastTx(structTx: TxStruct, to?: string): void {
    const me: string = this.wallet.getPublicKey();
    const txMsg: string = new TxMessage(structTx, me).asString(this.wallet);
    this.network.broadcast(txMsg, to);
  }
}
