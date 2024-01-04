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

import { Logger } from '../logger.js';
import { Server } from './server.js';
import { Util } from '../chain/util.js';
import { CommandAddPeer } from '../chain/tx.js';
import { nanoid } from 'nanoid';
import { toB32 } from '@diva.exchange/i2p-sam';
import { Chain } from '../chain/chain.js';

const LENGTH_TOKEN: number = 32;
const WAIT_JOIN_MS: number = 30000;
const MAX_RETRY_JOIN: number = 10;

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;
  private timeoutChallenge: NodeJS.Timeout = {} as NodeJS.Timeout;
  private isJoiningNetwork: boolean = false;

  static make(server: Server): Bootstrap {
    return new Bootstrap(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.mapToken = new Map();
  }

  async syncWithNetwork(): Promise<void> {
    Logger.trace('Bootstrap: syncWithNetwork()');
    //@TODO
    /*
    const genesis: TxStruct | undefined = await this.server.getNetwork().fetchFromApi('genesis');
    const blockNetwork: BlockStruct | undefined = await this.server.getNetwork().fetchFromApi('block/latest');
    const txLocal: TxStruct = this.server.getChain().getLatestTx();

    if (blockNetwork && genesis && blockLocal.hash !== blockNetwork.hash) {
      await this.server.getChain().reset(genesis);
      let h: number = 1;
      while (blockNetwork.height > h) {
        for (const b of (await this.server.getNetwork().fetchFromApi('sync/' + (h + 1))) || []) {
          await this.server.getChain().add(tx);
        }
        h = this.server.getChain().getLatestTx().height;
      }
    }
*/

    Logger.trace('Bootstrap: syncWithNetwork() done');
  }

  // executed by a new node only
  async joinNetwork(publicKey: string): Promise<void> {
    this.isJoiningNetwork = true;
    await this.server
      .getNetwork()
      .fetchFromApi('join/' + [this.server.config.http, this.server.config.udp, publicKey].join('/'));
  }

  // executed by a new node only
  challenge(token: string): string {
    const v: boolean = this.isJoiningNetwork && token.length === LENGTH_TOKEN;
    this.isJoiningNetwork = false;
    return v ? this.server.getWallet().sign(token) : '';
  }

  // executed by an existing node, processing an incoming new node
  join(http: string, udp: string, publicKey: string, r: number = 0): boolean {
    clearTimeout(this.timeoutChallenge);

    if (
      !http.length ||
      !udp.length ||
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
      this.mapToken.has(publicKey) ||
      this.server.getChain().hasPeer(publicKey)
    ) {
      this.mapToken.delete(publicKey);
      return false;
    }

    const token = nanoid(LENGTH_TOKEN);
    this.mapToken.set(publicKey, token);

    this.timeoutChallenge = setTimeout(async () => {
      try {
        const res: { token: string } | undefined = await this.server
          .getNetwork()
          .fetchFromApi(`http://${toB32(http)}.b32.i2p/challenge/${token}`);
        res && this.confirm(http, udp, publicKey, res.token);
      } catch (error: any) {
        Logger.warn(`Bootstrap.join(): challenging error - ${error.toString()}`);

        // retry
        if (r < MAX_RETRY_JOIN) {
          this.mapToken.delete(publicKey);
          setImmediate((): void => {
            this.join(http, udp, publicKey, r++);
          });
        } else {
          Logger.info(`Bootstrap.join(): max retries to get challenge confirmation reached (${MAX_RETRY_JOIN})`);
        }
      }
    }, WAIT_JOIN_MS);

    return true;
  }

  // executed by an existing node, processing an incoming new node
  private confirm(http: string, udp: string, publicKey: string, signedToken: string): void {
    const token: string = this.mapToken.get(publicKey) || '';

    if (!token || !Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm(): Util.verifySignature() failed');
    }

    if (
      !this.server.stackTx([
        {
          command: Chain.COMMAND_ADD_PEER,
          http: http,
          udp: udp,
          publicKey: publicKey,
        } as CommandAddPeer,
      ])
    ) {
      throw new Error('Bootstrap.confirm(): stackTransaction(addPeer) failed');
    }
    this.mapToken.delete(publicKey);
  }
}
