/**
 * Copyright (C) 2021-2022 diva.exchange
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

import { Logger } from '../logger';
import { Server } from './server';
import { Util } from '../chain/util';
import { CommandAddPeer } from '../chain/transaction';
import { BlockStruct } from '../chain/block';
import { nanoid } from 'nanoid';
import { toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import { Blockchain } from '../chain/blockchain';

const LENGTH_TOKEN = 32;
const WAIT_JOIN_MS = 30000;
const MAX_RETRY_JOIN = 10;

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

  async syncWithNetwork() {
    Logger.trace('Bootstrap: syncWithNetwork()');

    const blockNetwork: BlockStruct | undefined = await this.server.getNetwork().fetchFromApi('block/latest');
    const genesis: BlockStruct | undefined = await this.server.getNetwork().fetchFromApi('block/genesis');
    const blockLocal: BlockStruct = this.server.getBlockchain().getLatestBlock();

    if (blockNetwork && genesis && blockLocal.hash !== blockNetwork.hash) {
      await this.server.getBlockchain().reset(genesis);
      let h = 1;
      while (blockNetwork.height > h) {
        for (const b of (await this.server.getNetwork().fetchFromApi('sync/' + (h + 1))) || []) {
          await this.server.getBlockchain().add(b);
        }
        h = this.server.getBlockchain().getLatestBlock().height;
      }
    }

    Logger.trace('Bootstrap: syncWithNetwork() done');
  }

  // executed by a new node only
  async joinNetwork(publicKey: string) {
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
      this.server.getBlockchain().hasPeer(publicKey)
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
          setImmediate(() => {
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
  private confirm(http: string, udp: string, publicKey: string, signedToken: string) {
    const token = this.mapToken.get(publicKey) || '';

    if (!token || !Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm(): Util.verifySignature() failed');
    }

    if (
      !this.server.stackTx([
        {
          seq: 1,
          command: Blockchain.COMMAND_ADD_PEER,
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
