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

import { Server } from './server.ts';
import { Wallet } from '../chain/wallet.ts';
import { Command, Tx, TxStruct, VoteStruct } from '../chain/tx.ts';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { TxMessage } from './message/tx.ts';
import { VoteMessage } from './message/vote.ts';
import { StatusMessage } from './message/status.ts';
import { Log } from '../logger.ts';
import { Config } from '../config.ts';
import { Network } from './network.ts';
import { Util } from '../chain/util.ts';

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

  private mapStatus: Map<string, StatusMessage> = new Map();

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
    //@FIXME logging
    Log.trace(`${this.config.port}: Stacking TX...`);

    if (this.stackTransaction.push({ commands: commands })) {
      return this.createOwnTx();
    }
    return false;
  }

  getStack(): Array<recordStack> {
    return this.stackTransaction;
  }

  private createOwnTx(): boolean {
    if (this.ownTx.height) {
      return true;
    }

    const me: string = this.wallet.getPublicKey();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(me);

    if (!this.stackTransaction.length || !prevTx) {
      return false;
    }

    const r: recordStack = this.stackTransaction.shift() as recordStack;
    try {
      const tx: TxStruct = new Tx(this.wallet, prevTx, r.commands).get();
      this.validation.validateTx(tx);
      this.ownTx = tx;
    } catch (e: unknown) {
      Log.warn(
        `${this.config.port}: local TX validation failed ${
          (e as Error).toString()
        }`,
      );
      return false;
    }
    this.mapTx.set(this.ownTx.hash, this.ownTx);

    // broadcast ownTx
    this.broadcastTx(this.ownTx);

    //@FIXME logging
    Log.trace(
      `${this.config.port}: TX created on ${me} #${
        this.chain.getListPeer().indexOf(me)
      }`,
    );

    return true;
  }

  async processTx(tx: TxMessage): Promise<void> {
    const structTx: TxStruct = tx.tx();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(
      structTx.origin,
    );

    // not interested
    if (
      !prevTx || prevTx.height + 1 !== structTx.height ||
      prevTx.hash !== structTx.prev
    ) {
      return;
    }

    // check hash
    if (structTx.hash !== Util.hash(structTx)) {
      //@FIXME serious breach
      Log.trace(`${this.config.port}: TX invalid hash`);
      return;
    }
    // check existing vote from origin
    if (
      !structTx.votes.some((v: VoteStruct): boolean => {
        return v.origin === structTx.origin;
      })
    ) {
      //@FIXME serious breach
      Log.trace(`${this.config.port}: TX missing vote from origin`);
      return;
    }
    // check all votes (signatures)
    if (
      !structTx.votes.every((v: VoteStruct): boolean => {
        return Util.verifySignature(v.origin, v.sig, structTx.hash);
      })
    ) {
      //@FIXME serious breach
      Log.trace(`${this.config.port}: TX invalid votes`);
      return;
    }

    //@TODO stateful? Reason to add own vote?
    const me: string = this.wallet.getPublicKey();
    if (
      !structTx.votes.some((v: VoteStruct): boolean => {
        return v.origin === me;
      })
    ) {
      structTx.votes = structTx.votes.concat({
        origin: me,
        sig: this.wallet.sign(structTx.hash),
      });
      this.mapTx.set(structTx.hash, structTx);

      await this.addTx(structTx);
    }
  }

  async processVote(vote: VoteMessage): Promise<void> {
    const structTx: TxStruct | undefined = this.mapTx.get(vote.hash());

    // not interested
    if (!structTx) {
      return;
    }

    // new votes?
    const aV: Array<VoteStruct> = vote.votes().filter(
      (v: VoteStruct): boolean => {
        return (
          !structTx.votes.some((vO: VoteStruct): boolean => {
            return vO.origin === v.origin;
          }) && Util.verifySignature(v.origin, v.sig, structTx.hash)
        );
      },
    );
    if (!aV.length) {
      return;
    }

    structTx.votes = structTx.votes.concat(aV);
    this.mapTx.set(vote.hash(), structTx);

    await this.addTx(structTx);
  }

  async processStatus(status: StatusMessage): Promise<void> {
    const me: string = this.wallet.getPublicKey();
    for await (const r of status.matrix()) {
      let height: number = this.chain.getHeight(r.origin) || 0;
      //@TODO hardcoded limit of 5 txs
      height = height > r.height + 5 ? r.height + 5 : height;
      for (let h = r.height + 1; h <= height; h++) {
        const structTx: TxStruct | undefined = await this.chain.getTx(
          h,
          r.origin,
        );
        structTx && this.broadcastTx(structTx, status.getOrigin());
      }

      // resend ownTx
      r.origin === me && r.height + 1 === this.ownTx.height &&
        this.broadcastTx(this.ownTx, status.getOrigin());
    }
    this.mapStatus.set(status.getOrigin(), status);
  }

  getStatus(): Array<StatusMessage> {
    return [...this.mapStatus.values()];
  }

  private async addTx(structTx: TxStruct): Promise<void> {
    if (!this.chain.hasQuorum(structTx.votes.length)) {
      const me: string = this.wallet.getPublicKey();
      this.network.broadcast(
        new VoteMessage({ hash: structTx.hash, votes: structTx.votes }, me)
          .asString(this.wallet),
      );
      return;
    }

    //@FIXME logging
    Log.trace(
      `${this.config.port}: NEW TX stored locally #${structTx.height} from ${structTx.origin}`,
    );

    try {
      await this.chain.add(structTx);
    } catch (error) {
      Log.warn(`${this.config.port}: addTx failed, ${error}`);
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
