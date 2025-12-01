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
import { toB32 } from '@i2p/sam';
import { CommandRemovePeer, TxStruct } from '../chain/tx.ts';
import { Peer } from '../chain/chain.ts';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet.ts';
import { Log } from '../logger.ts';
import { Hono } from '@hono/hono/tiny';
import { Context } from '@hono/hono';
import { HTTPException } from '@hono/hono/http-exception';

export class Api {
  private server: Server;
  private app: Hono;
  private httpServer: Deno.HttpServer;

  static make(server: Server): Api {
    return new Api(server);
  }

  private constructor(server: Server) {
    this.server = server;

    // tiny router, strict is ALWAYS false
    this.app = new Hono({ strict: false });

    // generic error handling
    this.app.onError((err: Error, c: Context) => {
      Log.error(`${err}`);
      return c.text('500', 500);
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
        Log.info(
          `HttpServer (API) listening on ${hostname}:${port}`,
        );
      },
    }, this.app.fetch);

    this.httpServer.finished.then(() => {
      Log.info(
        `HttpServer (API) closed on ${this.server.config.ip}:${this.server.config.port}`,
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
    this.app.get('/join/:http/:udp/:publicKey', (c: Context) => this.join(c));

    // GET - challenge
    this.app.get('/challenge/:token', (c: Context) => this.challenge(c));

    // GET - synchronization
    this.app.get(
      '/sync/:height/:origin?',
      async (c: Context) => await this.sync(c),
    );

    // GET testnet
    this.app.get('/testnet/token', (c: Context) => this.tokenTestnet(c));

    // GET - network status
    this.app.get('/network/status', (c: Context) => this.status(c));

    // GET - broadcasting network
    this.app.get('/network/broadcast', (c: Context) => this.broadcast(c));

    // GET - total network
    this.app.get('/network/:stake?', (c: Context) => this.network(c));

    // GET - state
    this.app.get(
      '/state/search/:q?',
      async (c: Context) => await this.stateSearch(c),
    );
    this.app.get('/state/:key', async (c: Context) => await this.state(c));

    // GET - stack
    this.app.get('/stack', (c: Context) => this.getStack(c));

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

    //@TODO access rights? (next to the token)
    // PUT
    this.app.put('/tx', async (c: Context) => {
      if (
        c.req.header(NAME_HEADER_TOKEN_API) ===
          this.server.getWallet().getTokenAPI()
      ) {
        return await this.putTransaction(c);
      }
      throw new HTTPException(401);
    });
    this.app.put('/leave', (c: Context) => {
      if (
        c.req.header(NAME_HEADER_TOKEN_API) ===
          this.server.getWallet().getTokenAPI()
      ) {
        return this.leave(c);
      }
      throw new HTTPException(401);
    });

    /*
    // GET - debug
    this.app.get('/debug/performance/:height', async (req: Request, res: Response): Promise<Response> => {
      return res.json(await this.server.getChain().getPerformance(Number(req.params.height || 0)));
    });
    */
  }

  private about(c: Context) {
    return c.json({
      version: denoJSON.version,
      publicKey: this.server.getWallet().getPublicKey(),
    });
  }

  private join(c: Context) {
    const b = this.server.getBootstrap().join(
      c.req.param('http'),
      c.req.param('udp'),
      c.req.param('publicKey'),
    );
    if (b) {
      return c.json({
        http: toB32(c.req.param('http')),
        udp: toB32(c.req.param('udp')),
        publicKey: c.req.param('publicKey'),
      });
    }
    throw new HTTPException(403);
  }

  private challenge(c: Context) {
    const signedToken: string = this.server.getBootstrap().challenge(
      c.req.param('token'),
    );
    if (signedToken) {
      return c.json({ token: signedToken });
    }
    throw new HTTPException(403);
  }

  private leave(c: Context) {
    if (
      this.server.stackTx([
        {
          publicKey: this.server.getWallet().getPublicKey(),
        } as CommandRemovePeer,
      ])
    ) {
      return c.body(null, 204);
    }
    throw new HTTPException(403);
  }

  private async sync(c: Context) {
    const origin: string = c.req.param('origin') ||
      this.server.getWallet().getPublicKey();
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
    const s: number = Math.floor(Number(c.req.param('stake'))) || 0;
    const a: Array<Peer> = this.server.getNetwork().getArrayNetwork();
    return c.json(s > 0 ? a.filter((r: Peer): boolean => r['stake'] >= s) : a);
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
    return c.json(this.server.getTxFactory().getStatus());
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

  private getStack(c: Context) {
    return c.json(this.server.getTxFactory().getStack());
  }

  private async getGenesis(c: Context) {
    const tx: TxStruct | undefined = await this.server.getChain().getTx(
      1,
      this.server.getWallet().getPublicKey(),
    );
    return tx ? c.json(tx) : c.notFound();
  }

  private getLatest(c: Context) {
    const origin: string = this.isStringPublicKey(c.req.param('origin') || '')
      ? c.req.param('origin')
      : this.server.getWallet().getPublicKey();
    const tx: TxStruct | undefined = this.server.getChain().getLatestTx(origin);
    return tx ? c.json(tx) : c.notFound();
  }

  private async getTx(c: Context) {
    const origin: string = this.isStringPublicKey(c.req.param('origin') || '')
      ? c.req.param('origin')
      : this.server.getWallet().getPublicKey();
    const height: number = Number(c.req.param('height')) || 0;
    const tx: TxStruct | undefined = await this.server.getChain().getTx(
      height,
      origin,
    );
    return tx ? c.json(tx) : c.notFound();
  }

  private async search(c: Context) {
    const q: string = (c.req.param('q') || '').trim();
    if (q.length < 3) {
      throw new HTTPException(403);
    }

    let a: Array<TxStruct> = [];
    if (c.req.param('origin')) {
      // search single origin
      return c.json(
        (await this.server.getChain().search(q, c.req.param('origin'))) || [],
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
    return a ? c.json(a.reverse()) : c.notFound();
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
    return a ? c.json(a) : c.notFound();
  }

  private async putTransaction(c: Context) {
    if (this.server.stackTx(await c.req.json())) {
      return c.body(null, 204);
    }
    throw new HTTPException(403);
  }

  private isStringPublicKey(s: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(s);
  }
}
