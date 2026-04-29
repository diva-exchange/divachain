/**
 * Copyright (C) 2022-2026 diva.exchange
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

import denoJSON from '../../deno.json' with { type: 'json' };
import { Server } from './server.ts';
import { Command, TxStruct } from '../chain/tx.ts';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet.ts';
import { Log } from '../logger.ts';
import { Hono } from '@hono/hono/tiny';
import { Context } from '@hono/hono';
import { HTTPException } from '@hono/hono/http-exception';
import { Chain, Peer } from '../chain/chain.ts';
import { toB32 } from '@i2p/sam';

export class Api {
  private server: Server;
  private app: Hono;
  private httpServer: Deno.HttpServer;

  static make(server: Server): Api {
    const a: Api = new Api(server);
    return a;
  }

  private constructor(server: Server) {
    this.server = server;

    // tiny router, strict is ALWAYS false
    this.app = new Hono({ strict: false });

    // generic error handling
    this.app.onError((error: unknown, c: Context) => {
      const _err: HTTPException = error as HTTPException;
      Log.error(`API Error: ${_err.message || _err.status}`);
      return c.text(`${_err.status}`, _err.status);
    });
    this.app.notFound((c: Context) => {
      return c.text('Not Found', 404);
    });

    this.route();

    // Web Server
    this.httpServer = Deno.serve({
      port: this.server.config.port,
      hostname: this.server.config.ip,
      onListen({ port, hostname }) {
        Log.info(`API (http/rest) listening on ${hostname}:${port}`);
      },
    }, this.app.fetch);

    this.httpServer.finished.then(() => {
      Log.info(
        `API closed on ${this.server.config.ip}:${this.server.config.port}`,
      );
    });
  }

  public async shutdown() {
    await this.httpServer.shutdown();
  }

  private route(): void {
    // catch unavailable favicon.ico early
    this.app.get('/favicon.ico', (c: Context) => {
      return c.body(null, 204);
    });

    // GET - about
    this.app.get('/about', (c: Context) => this.about(c));

    // GET - join
    this.app.get('/join/:origin/:http', (c: Context) => this.join(c));

    // GET - leave
    this.app.get('/leave/:origin', (c: Context) => this.leave(c));

    // GET - synchronization
    this.app.get(
      '/sync/:height/:origin?',
      async (c: Context) => await this.sync(c),
    );

    // GET testnet
    this.app.get('/testnet/token', (c: Context) => this.tokenTestnet(c));

    // GET - network status
    this.app.get('/network/status/:origin?', (c: Context) => this.status(c));

    // GET - network reputation
    this.app.get(
      '/network/reputation/:origin?',
      (c: Context) => this.reputation(c),
    );

    // GET - broadcasting network
    this.app.get('/network/broadcast', (c: Context) => this.broadcast(c));

    // GET - total network
    this.app.get('/network', (c: Context) => this.network(c));

    // GET - state
    this.app.get(
      '/state/search/:q?',
      async (c: Context) => await this.stateSearch(c),
    );
    this.app.get('/state/:key', async (c: Context) => await this.state(c));
    this.app.get(
      '/state',
      async (c: Context) => await this.stateSearch(c),
    );

    // GET - tx
    this.app.get('/genesis', async (c: Context) => await this.getGenesis(c));
    this.app.get(
      '/tx/latest/:origin?',
      (c: Context) => this.getLatest(c),
    );
    this.app.get(
      '/tx/:height/:origin?',
      async (c: Context) => await this.getTx(c),
    );

    // GET - txs
    this.app.get(
      '/txs/search/:q/:origin?',
      async (c: Context) => await this.search(c),
    );
    this.app.get(
      '/txs/page/:page/:size?/:origin?',
      async (c: Context) => await this.getPage(c),
    );
    this.app.get(
      '/txs/:gte?/:lte?/:origin?',
      async (c: Context) => await this.txs(c),
    );

    // TODO access rights? (next to the token)
    // PUT
    this.app.put('/tx', async (c: Context) => {
      if (
        c.req.header(NAME_HEADER_TOKEN_API) ===
          this.server.getWallet().getTokenAPI()
      ) {
        return await this.putTransaction(c);
      }

      throw new HTTPException(401, { message: 'Token invalid' });
    });
  }

  private about(c: Context) {
    return c.json({
      version: denoJSON.version,
      publicKey: this.server.getWallet().getPublicKey(),
    });
  }

  private async join(c: Context) {
    const o: string = c.req.param('origin') || '';
    const h: string = c.req.param('http') || '';
    if (!this.isStringPublicKey(o) || this.server.getChain().hasPeer(o)) {
      throw new HTTPException(403);
    }

    // TODO implement properly
    Log.trace(`New peer joining: ${o}`);
    const r: Response | false = await this.server.fetchFromApi(
      `http://${toB32(h)}.b32.i2p/network/`,
    );
    const aPeer: Array<Peer> = r ? await r.json() : [];
    aPeer.forEach(async (peer: Peer) => {
      if (peer.publicKey === o && peer.http === h) {
        await this.server.getChain().addPeer(peer);
      }
    });

    // accepted
    return c.json('', 202);
  }

  // TODO
  private leave(c: Context) {
    return c.json('', 202);
  }

  private async sync(c: Context) {
    const origin: string = c.req.param('origin') || '';
    const h: number = Math.floor(Number(c.req.param('height'))) || 1;
    const height: number = this.server.getChain().getHeight(origin) || 0;
    return height >= h
      ? c.json(
        await this.server.getChain().getRange(
          h,
          h + this.server.config.network_sync_size,
          origin,
        ),
      )
      : c.notFound();
  }

  private network(c: Context) {
    return c.json(this.server.getNetwork().getArrayNetwork());
  }

  private broadcast(c: Context) {
    return c.json(this.server.getNetwork().getArrayBroadcast());
  }

  private tokenTestnet(c: Context) {
    if (this.server.config.is_testnet) {
      return c.json({
        header: NAME_HEADER_TOKEN_API,
        token: this.server.getWallet().getTokenAPI(),
      });
    }
    throw new HTTPException(403);
  }

  private status(c: Context) {
    const o: string = c.req.param('origin') || '';
    const origin: string = this.isStringPublicKey(o) ? o : '';
    return c.json(this.server.getNetwork().getStatus(origin));
  }

  private reputation(c: Context) {
    const o: string = c.req.param('origin') || '';
    const origin: string = this.isStringPublicKey(o) ? o : '';
    return c.json(this.server.getNetwork().getReputation(origin));
  }

  private async stateSearch(c: Context) {
    return c.json(
      await this.server.getChain().searchState(c.req.param('q') || ''),
    );
  }

  private async state(c: Context) {
    const key: string = c.req.param('key') || '';
    const state: { key: string; value: string } | false = await this.server
      .getChain().getState(key);
    return state ? c.json(state) : c.notFound();
  }

  private async getGenesis(c: Context) {
    try {
      return c.json(await Chain.genesis(this.server.config.path_genesis));
    } catch (_e) {
      return c.notFound();
    }
  }

  private getLatest(c: Context) {
    const o: string = c.req.param('origin') || '';
    const origin: string = this.isStringPublicKey(o) ? o : '';
    const tx: TxStruct | undefined = this.server.getChain().getLatestTx(origin);
    return tx ? c.json(tx) : c.notFound();
  }

  private async getTx(c: Context) {
    const o: string = c.req.param('origin') || '';
    const origin: string = this.isStringPublicKey(o) ? o : '';
    const height: number = Number(c.req.param('height')) || 0;
    const tx: TxStruct | undefined = await this.server.getChain().getTx(
      height,
      origin,
    );
    return tx ? c.json(tx) : c.notFound();
  }

  // TODO response of 204 if nothing found?
  private async search(c: Context) {
    const q: string = (c.req.param('q') || '').trim();
    if (q.length < 3) {
      throw new HTTPException(403);
    }

    let a: Array<TxStruct> = [];
    const o: string = c.req.param('origin') || '';
    const origin: string = this.isStringPublicKey(o) ? o : '';
    if (origin) {
      // search single origin
      return c.json(
        (await this.server.getChain().search(q, origin)) || [],
      );
    } else {
      // search all
      for (const origin of this.server.getChain().getListPeer()) {
        a = a.concat((await this.server.getChain().search(q, origin)) || []);
      }
      return c.json(a);
    }
  }

  private async getPage(c: Context) {
    const page: number = Number(c.req.param('page')) || 1;
    const size: number = Number(c.req.param('size')) || 0;
    let origin: string = c.req.param('origin') || c.req.param('size') || '';
    origin = this.isStringPublicKey(origin)
      ? origin
      : this.server.getWallet().getPublicKey();
    const a: Array<TxStruct> | undefined = await this.server.getChain().getPage(
      page,
      size,
      origin,
    );
    return a
      ? (a.length ? c.json(a.reverse()) : c.body(null, 204))
      : c.notFound();
  }

  private async txs(c: Context) {
    const gte: number = Math.floor(Number(c.req.param('gte'))) || 1;
    const lte: number = Math.floor(Number(c.req.param('lte'))) || 0;
    let origin: string = c.req.param('origin') || c.req.param('lte') ||
      c.req.param('gte') || '';
    origin = this.isStringPublicKey(origin)
      ? origin
      : this.server.getWallet().getPublicKey();
    const a: Array<TxStruct> | undefined = await this.server.getChain()
      .getRange(gte, lte, origin);
    return a ? (a.length ? c.json(a) : c.body(null, 204)) : c.notFound();
  }

  private async putTransaction(c: Context) {
    const commands: Array<Command> = await c.req.json();
    if ((await this.server.getTxFactory().createOwnTx(commands))) {
      return c.body(null, 204);
    }
    throw new HTTPException(403, { message: 'Invalid Tx' });
  }

  private isStringPublicKey(s: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(s);
  }
}
