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
import { Command, Tx, TxStruct } from '../chain/tx.ts';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { TxMessage, TxMessageStruct } from './message/tx.ts';
import { Log } from '../logger.ts';
import { Config } from '../config.ts';
import { Network } from './network.ts';
import { Util } from '../chain/util.ts';
import { toB32 } from '@i2p/sam';

export class TxFactory {
  private readonly server: Server;
  private readonly config: Config;
  private readonly chain: Chain;
  private readonly network: Network;
  private readonly validation: Validation;
  private readonly wallet: Wallet;

  private ownTx: TxStruct = {} as TxStruct;

  public static make(server: Server): TxFactory {
    const t: TxFactory = new TxFactory(server);
    Log.info('TxFactory ready');
    return t;
  }

  private constructor(server: Server) {
    this.server = server;
    this.config = server.config;
    this.chain = server.getChain();
    this.network = server.getNetwork();
    this.validation = server.getValidation();
    this.wallet = server.getWallet();
  }

  public shutdown() {
    // TODO cleanup
  }

  /**
   * Add a transaction locally
   * @param commands Array<Command>
   * @returns boolean
   */
  public createOwnTx(commands: Array<Command>): boolean {
    if (this.ownTx.h) {
      return true;
    }

    const me: string = this.wallet.getPublicKey();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(me);

    if (!prevTx) {
      return false;
    }

    const tx: TxStruct = new Tx(this.wallet, prevTx, commands).get();
    try {
      this.validation.validateTx(tx as TxMessageStruct);
      this.ownTx = tx;
    } catch (e: unknown) {
      Log.warn(`local TX validation failed ${(e as Error).toString()}`);
      return false;
    }

    // broadcast ownTx
    (async () => {
      await this.broadcastTx(tx);
    })();

    // add own tx
    (async () => {
      await this.addTx(tx);
      // FIXME logging
      Log.trace(`TX created on ${me}`);
    })();

    return true;
  }

  public async processTx(tx: TxMessage): Promise<void> {
    const structTx: TxStruct = tx.tx();
    const prevTx: TxStruct | undefined = this.chain.getLatestTx(
      structTx.o,
    );

    // TODO peel coin from TxMessage

    // chain locally not available, not interested
    if (!prevTx) {
      Log.trace(`processTx, chain locally not available: ${structTx.o}`);
      return;
    }

    // already processed
    if (prevTx.h >= structTx.h) {
      return;
    }

    // not in sync
    if (prevTx.h + 1 < structTx.h) {
      Log.trace(
        `Not in sync for TX: ${structTx.h} from ${structTx.o}`,
      );
      setTimeout(async () => {
        await this.sync(structTx.o);
      }, 0);
      return;
    }

    // check hash
    if (
      prevTx.ha !== structTx.p || structTx.ha !== Util.hash(structTx)
    ) {
      // FIXME serious breach
      Log.warn(`${structTx.ha}: TX invalid hash`);
      return;
    }

    await this.addTx(structTx);
  }

  private async addTx(structTx: TxStruct): Promise<void> {
    // FIXME logging
    Log.trace(
      `NEW TX stored locally #${structTx.h} from ${structTx.o}`,
    );

    try {
      await this.chain.add(structTx);
    } catch (error: unknown) {
      Log.warn(`addTx failed, ${error as Error}`);
      return;
    }

    if (this.ownTx.ha === structTx.ha) {
      this.ownTx = {} as TxStruct;
    }

    // push the tx to the queue of the feed (websocket)
    this.server.queueWebSocketFeed(structTx);
  }

  private async broadcastTx(structTx: TxStruct, to?: string) {
    const me: string = this.wallet.getPublicKey();
    const txMsg: string = new TxMessage(structTx, me).asString(this.wallet);
    await this.network.broadcast(txMsg, to);
  }

  private async sync(pk: string, retry: number = 0) {
    let dest: string = this.chain.getPeer(pk).http;
    if (!dest) {
      return;
    }
    dest = toB32(dest) + '.b32.i2p';
    const height: number = (this.chain.getLatestTx(pk)?.h || 0) + 1;
    Log.trace(`Syncing ${pk} @ ${dest} starting at #${height}...`);

    // Request specs: see api.ts
    const url: string = `http://${dest}/txs/${height}`;
    try {
      // proxy, socks5
      const response = await fetch(url, {
        client: Deno.createHttpClient({
          proxy: {
            url: 'socks5://' + this.config.i2p_socks,
          },
        }),
        signal: AbortSignal.timeout(this.config.network_timeout_ms),
      });

      let j: Array<TxStruct> = [];
      switch (response.status) {
        case 200:
          j = await response.json();
          for await (const tx of j) {
            await this.processTx(new TxMessage(tx, pk));
          }
          break;
        case 204:
          Log.trace(`Empty sync (204) from ${url}`);
          break;
        default:
          throw new Error(
            `Sync not successful (${response.status}) from ${url}`,
          );
      }
    } catch (error: unknown) {
      Log.trace(`Sync error, ${url}: ${error as Error}`);
      if (retry < 120) {
        setTimeout(async () => {
          await this.sync(pk, ++retry);
        }, 500);
      }
    }
  }
}
