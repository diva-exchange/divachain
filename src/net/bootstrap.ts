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
import zlib from 'zlib';
import { base64url } from 'rfc4648';

const LENGTH_TOKEN = 32;
const MIN_WAIT_JOIN_MS = 15000;
const MAX_WAIT_JOIN_MS = 60000;
const MAX_RETRY_JOIN = 10;

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;

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
        const arrayBlocks: Array<BlockStruct> = await this.server.getNetwork().fetchFromApi('sync/' + (h + 1));
        for (const b of arrayBlocks) {
          this.server.getBlockchain().add(b);
        }
        h = this.server.getBlockchain().getLatestBlock().height;
      }
    }
  }
  async enterNetwork(publicKey: string) {
    const s = base64url.stringify(
      zlib.deflateRawSync([this.server.config.http, this.server.config.udp, publicKey].join(':'))
    );

    //@FIXME logging
    Logger.trace('Joining network: ' + 'join/' + s);

    await this.server.getNetwork().fetchFromApi('join/' + s);
  }

  join(b64u: string, t: number = MIN_WAIT_JOIN_MS, r: number = 0): boolean {
    let [http, udp, publicKey] = ''.split(':');
    try {
      [http, udp, publicKey] = zlib.inflateRawSync(base64url.parse(b64u)).toString().split(':');
    } catch (error: any) {
      Logger.warn('Bootstrap.join() ' + error.toString());
      return false;
    }

    if (
      !http.length ||
      !udp.length ||
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
      this.mapToken.has(publicKey) ||
      this.server.getBlockchain().hasPeer(publicKey)
    ) {
      return false;
    }

    t = Math.floor(t);
    t = t < MIN_WAIT_JOIN_MS ? MIN_WAIT_JOIN_MS : t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t;

    const token = nanoid(LENGTH_TOKEN);
    this.mapToken.set(publicKey, token);

    setTimeout(async () => {
      let res: { token: string } = { token: '' };
      try {
        http = http.indexOf('.') === -1 ? toB32(http) + '.b32.i2p' : http;
        res = JSON.parse(await this.server.getNetwork().fetchFromApi('http://' + http + '/challenge/' + token));
        this.confirm(http, udp, publicKey, res.token);
      } catch (error: any) {
        Logger.warn('Bootstrap.join() / challenge ' + error.toString());

        // retry
        if (r < MAX_RETRY_JOIN) {
          this.mapToken.delete(publicKey);
          t = t + MIN_WAIT_JOIN_MS;
          setTimeout(() => {
            this.join(b64u, t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t, r++);
          }, t);
        } else {
          Logger.info('Bootstrap.join() / giving up');
        }
      }
    }, t);

    return true;
  }

  //@FIXME only accessible, if the server is in "challenging" state
  challenge(token: string): string {
    return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
  }

  private confirm(http: string, udp: string, publicKey: string, signedToken: string) {
    const token = this.mapToken.get(publicKey) || '';

    if (!Util.verifySignature(publicKey, signedToken, token)) {
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
