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

import { Log } from '../logger.ts';
import { Server } from './server.ts';
import { Util } from '../chain/util.ts';
import { nanoid } from 'nanoid';
import { clearTimeout, setImmediate, setTimeout } from 'node:timers';
import { Peer } from '../chain/chain.ts';

const LENGTH_TOKEN: number = 32;
const WAIT_JOIN_MS: number = 30000;
const MAX_RETRY_JOIN: number = 10;

export class Bootstrap {
  private readonly server: Server;
  private mapToken: Map<string, string>;
  private timeoutChallenge: NodeJS.Timeout = {} as NodeJS.Timeout;
  private isJoiningNetwork: boolean = false;

  public static make(server: Server): Bootstrap {
    return new Bootstrap(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.mapToken = new Map();
  }

  // executed by a new node only
  public async joinNetwork(publicKey: string) {
    this.isJoiningNetwork = true;

    const aPeer: Array<Peer> = [];
    const aP: Array<string> = this.server.config.bootstrap.split(',').map((s) =>
      s.trim()
    );
    for await (const p of aP) {
      if (!p.endsWith('.i2p')) return;
      const url: string = `http://${p}/network/`;
      // proxy, socks5
      const response = await fetch(url, {
        client: Deno.createHttpClient({
          proxy: {
            url: 'socks5://' + this.server.config.i2p_socks,
          },
        }),
        signal: AbortSignal.timeout(this.server.config.network_timeout_ms),
      });
      (await response.json()).forEach((peer: Peer) => {
        if (!aPeer.includes(peer)) aPeer.push(peer);
      });
    }
    Log.trace(`Bootstrap.joinNetwork aPeer ${JSON.stringify(aPeer)}`);
  }

  // executed by a new node only
  public challenge(token: string): string {
    const v: boolean = this.isJoiningNetwork && token.length === LENGTH_TOKEN;
    this.isJoiningNetwork = false;
    return v ? this.server.getWallet().sign(token) : '';
  }

  // executed by an existing node, processing an incoming new node
  public join(
    http: string,
    udp: string,
    publicKey: string,
    r: number = 0,
  ): boolean {
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

    this.timeoutChallenge = setTimeout(() => {
      try {
        // FIXME
        const res: { token: string } = { token: 'dummy' };
        /*
        const res: { token: string } = await this
          .fetchFromApi(`http://${toB32(http)}.b32.i2p/challenge/${token}`);
        */
        res && this.confirm(http, udp, publicKey, res.token);
      } catch (error: unknown) {
        Log.warn(
          `Bootstrap.join(): challenging error - ${
            (error as Error).toString()
          }`,
        );

        // retry
        if (r < MAX_RETRY_JOIN) {
          this.mapToken.delete(publicKey);
          setImmediate((): void => {
            this.join(http, udp, publicKey, r++);
          });
        } else {
          Log.info(
            `Bootstrap.join(): max retries to get challenge confirmation reached (${MAX_RETRY_JOIN})`,
          );
        }
      }
    }, WAIT_JOIN_MS);

    return true;
  }

  // executed by an existing node, processing an incoming new node
  private confirm(
    http: string,
    udp: string,
    publicKey: string,
    signedToken: string,
  ): void {
    const token: string = this.mapToken.get(publicKey) || '';

    if (!token || !Util.verifySignature(publicKey, signedToken, token)) {
      throw new Error('Bootstrap.confirm(): Util.verifySignature() failed');
    }

    this.mapToken.delete(publicKey);
  }
}
