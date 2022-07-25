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

import { Logger } from '../logger';
import { Server } from './server';
import { Util } from '../chain/util';
import { CommandAddPeer } from '../chain/transaction';
import { BlockStruct } from '../chain/block';
import { nanoid } from 'nanoid';
import { toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';

const LENGTH_TOKEN = 32;
const WAIT_JOIN_MS = 30000;
const MAX_RETRY_JOIN = 10;

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;
  private timeoutChallenge: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server): Bootstrap {
    return new Bootstrap(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.mapToken = new Map();
  }

  async syncWithNetwork() {
    const blockNetwork: BlockStruct = await this.server.getNetwork().fetchFromApi('block/latest');
    const blockLocal: BlockStruct = this.server.getBlockchain().getLatestBlock();

    if (blockLocal.hash !== blockNetwork.hash) {
      const genesis: BlockStruct = await this.server.getNetwork().fetchFromApi('block/genesis');
      await this.server.getBlockchain().reset(genesis);
      let h = 1;
      while (blockNetwork.height > h) {
        const arrayBlocks: Array<BlockStruct> = await this.server
          .getNetwork()
          .fetchFromApi('sync/' + (h + 1), this.server.config.network_timeout_ms * 2);
        for (const b of arrayBlocks) {
          this.server.getBlockchain().add(b);
        }
        h = this.server.getBlockchain().getLatestBlock().height;
      }
    }
  }

  async joinNetwork(publicKey: string) {
    Logger.trace('join/' + [this.server.config.http, this.server.config.udp, publicKey].join('/'));
    await this.server
      .getNetwork()
      .fetchFromApi('join/' + [this.server.config.http, this.server.config.udp, publicKey].join('/'));
  }

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
      let res: { token: string } = { token: '' };
      try {
        res = await this.server.getNetwork().fetchFromApi(`http://${toB32(http)}.b32.i2p/challenge/${token}`);
        this.confirm(http, udp, publicKey, res.token);
      } catch (error: any) {
        Logger.warn('Bootstrap.join() / challenge ' + error.toString());

        // retry
        if (r < MAX_RETRY_JOIN) {
          this.mapToken.delete(publicKey);
          setImmediate(() => {
            this.join(http, udp, publicKey, r++);
          });
        } else {
          Logger.info('Bootstrap.join() / giving up');
        }
      }
    }, WAIT_JOIN_MS);

    return true;
  }

  //@FIXME only accessible, if the server is in "challenging" state
  challenge(token: string): string {
    return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
  }

  private confirm(http: string, udp: string, publicKey: string, signedToken: string) {
    const token = this.mapToken.get(publicKey) || '';

    if (!token || !Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm() - Util.verifySignature() failed: ' + signedToken + ' / ' + token);
    }

    if (
      !this.server.stackTx([
        {
          seq: 1,
          command: 'addPeer',
          http: http,
          udp: udp,
          publicKey: publicKey,
        } as CommandAddPeer,
      ])
    ) {
      throw new Error('Bootstrap.confirm() - stackTransaction(addPeer) failed');
    }
    this.mapToken.delete(publicKey);
  }
}
