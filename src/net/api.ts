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
import { Request, Response } from 'express';
import { toB32 } from '@diva.exchange/i2p-sam';
import { CommandRemovePeer, TxStruct } from '../chain/tx.js';
import { Chain, Peer } from '../chain/chain.js';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export class Api {
  private package: any;
  private server: Server;

  static make(server: Server): Api {
    return new Api(server);
  }

  private constructor(server: Server) {
    const _d: string = path.dirname(fileURLToPath(import.meta.url));
    this.package = JSON.parse(fs.readFileSync(path.join(_d, '../../package.json')).toString());

    this.server = server;
    this.route();
  }

  private route(): void {
    // GET - general
    this.server.app.get('/about', async (req: Request, res: Response): Promise<Response> => {
      return await this.about(res);
    });

    // GET - joining
    this.server.app.get('/join/:http/:udp/:publicKey', (req: Request, res: Response): Response => {
      return this.join(req, res);
    });
    this.server.app.get('/challenge/:token', (req: Request, res: Response): Response => {
      return this.challenge(req, res);
    });

    // GET - synchronization
    this.server.app.get('/sync/:height/:origin?', async (req: Request, res: Response): Promise<Response> => {
      return await this.sync(req, res);
    });

    // GET testnet
    this.server.app.get('/testnet/token', async (req: Request, res: Response): Promise<Response> => {
      return this.server.config.is_testnet
        ? res.json({ header: NAME_HEADER_TOKEN_API, token: this.server.getWallet().getTokenAPI() })
        : res.status(403).end();
    });

    // GET - network status
    this.server.app.get('/network/status', (req: Request, res: Response): Response => {
      return this.status(res);
    });

    // GET - broadcasting network
    this.server.app.get('/network/broadcast', (req: Request, res: Response): Response => {
      return this.broadcast(res);
    });

    // GET - total network
    this.server.app.get('/network/:stake?', (req: Request, res: Response): Response => {
      return this.network(req, res);
    });

    // GET - state
    this.server.app.get('/state/search/:q?', async (req: Request, res: Response): Promise<Response> => {
      return await this.stateSearch(req, res);
    });
    this.server.app.get('/state/:key', async (req: Request, res: Response): Promise<Response> => {
      return await this.state(req, res);
    });

    // GET - stack
    this.server.app.get('/stack', async (req: Request, res: Response): Promise<Response> => {
      return this.getStack(res);
    });

    // GET - tx
    this.server.app.get('/genesis', async (req: Request, res: Response): Promise<Response> => {
      return await this.getGenesis(res);
    });
    this.server.app.get('/tx/latest/:origin?', (req: Request, res: Response): Response => {
      return this.getLatest(req, res);
    });
    this.server.app.get('/tx/:height/:origin?', async (req: Request, res: Response): Promise<Response> => {
      return await this.getTx(req, res);
    });

    // GET - txs
    this.server.app.get('/txs/search/:q/:origin?', async (req: Request, res: Response): Promise<Response> => {
      return await this.search(req, res);
    });
    this.server.app.get('/txs/page/:page/:size?/:origin?', async (req: Request, res: Response): Promise<Response> => {
      return await this.getPage(req, res);
    });
    this.server.app.get('/txs/:gte?/:lte?/:origin?', async (req: Request, res: Response): Promise<Response> => {
      return await this.txs(req, res);
    });

    //@TODO access rights? (next to the token)
    // PUT
    this.server.app.put('/tx', (req: Request, res: Response): Response => {
      return req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
        ? this.putTransaction(req, res)
        : res.status(401).end();
    });
    this.server.app.put('/leave', (req: Request, res: Response): Response => {
      return req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
        ? this.leave(res)
        : res.status(401).end();
    });

    /*
    // GET - debug
    this.server.app.get('/debug/performance/:height', async (req: Request, res: Response): Promise<Response> => {
      return res.json(await this.server.getChain().getPerformance(Number(req.params.height || 0)));
    });
*/
  }

  private join(req: Request, res: Response): Response {
    return this.server.getBootstrap().join(req.params.http, req.params.udp, req.params.publicKey)
      ? res.status(200).json({
          http: toB32(req.params.http),
          udp: toB32(req.params.udp),
          publicKey: req.params.publicKey,
        })
      : res.status(403).end();
  }

  private leave(res: Response): Response {
    if (
      this.server.stackTx([
        {
          command: Chain.COMMAND_REMOVE_PEER,
          publicKey: this.server.getWallet().getPublicKey(),
        } as CommandRemovePeer,
      ])
    ) {
      return res.status(200).end();
    }
    return res.status(403).end();
  }

  private challenge(req: Request, res: Response): Response {
    const signedToken: string = this.server.getBootstrap().challenge(req.params.token);
    return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
  }

  private async sync(req: Request, res: Response): Promise<Response> {
    const origin: string = req.params.origin || this.server.getWallet().getPublicKey();
    const h: number = Math.floor(Number(req.params.height)) || 1;
    const height: number = this.server.getChain().getHeight(origin) || 0;
    return height >= h
      ? res.json(await this.server.getChain().getRange(h, h + this.server.config.network_sync_size, origin))
      : res.status(404).end();
  }

  private async about(res: Response): Promise<Response> {
    return res.json({
      version: this.package.version,
      license: this.package.license,
      publicKey: this.server.getWallet().getPublicKey(),
    });
  }

  private network(req: Request, res: Response): Response {
    const s: number = Math.floor(Number(req.params.stake)) || 0;
    const a: Array<Peer> = this.server.getNetwork().getArrayNetwork();
    return res.json(s > 0 ? a.filter((r: Peer): boolean => r['stake'] >= s) : a);
  }

  private broadcast(res: Response): Response {
    return res.json(this.server.getNetwork().getArrayBroadcast());
  }

  private status(res: Response): Response {
    return res.json(this.server.getTxFactory().getStatus());
  }

  private async stateSearch(req: Request, res: Response): Promise<Response> {
    return res.json(await this.server.getChain().searchState(req.params.q || ''));
  }

  private async state(req: Request, res: Response): Promise<Response> {
    const key: string = req.params.key || '';
    const state: { key: string; value: string } | false = await this.server.getChain().getState(key);
    return state ? res.json(state) : res.status(404).end();
  }

  private getStack(res: Response): Response {
    return res.json(this.server.getTxFactory().getStack());
  }

  private async getGenesis(res: Response): Promise<Response> {
    const tx: TxStruct | undefined = await this.server.getChain().getTx(1, this.server.getWallet().getPublicKey());
    return tx ? res.json(tx) : res.status(404).end();
  }

  private getLatest(req: Request, res: Response): Response {
    const origin: string = this.isStringPublicKey(req.params.origin || '') ? req.params.origin : this.server.getWallet().getPublicKey();
    const tx: TxStruct | undefined = this.server.getChain().getLatestTx(origin);
    return tx ? res.json(tx) : res.status(404).end();
  }

  private async getTx(req: Request, res: Response): Promise<Response> {
    const origin: string = this.isStringPublicKey(req.params.origin || '') ? req.params.origin : this.server.getWallet().getPublicKey();
    const height: number = Number(req.params.height) || 0;
    const tx: TxStruct | undefined = await this.server.getChain().getTx(height, origin);
    return tx ? res.json(tx) : res.status(404).end();
  }

  private async search(req: Request, res: Response): Promise<Response> {
    const q: string = (req.params.q || '').trim();
    if (q.length < 3) {
      return res.status(403).end();
    }

    let a: Array<TxStruct> = [];
    // search single origin
    if (req.params.origin) {
      return res.json(await this.server.getChain().search(q, req.params.origin) || []);
    }
    // search all
    for (const origin of this.server.getChain().getListPeer()) {
      a = a.concat(await this.server.getChain().search(q, origin) || []);
    }
    return res.json(a);
  }

  private async getPage(req: Request, res: Response): Promise<Response> {
    const page: number = Number(req.params.page) || 1;
    const size: number = Number(req.params.size) || 0;
    let origin: string = req.params.origin || req.params.size || '';
    origin = this.isStringPublicKey(origin) ? origin : this.server.getWallet().getPublicKey();
    const a: Array<TxStruct> | undefined = await this.server.getChain().getPage(page, size, origin);
    return a ? res.json(a.reverse()) : res.status(404).end();
  }

  private async txs(req: Request, res: Response): Promise<Response> {
    const gte: number = Math.floor(Number(req.params.gte)) || 1;
    const lte: number = Math.floor(Number(req.params.lte)) || 0;
    let origin: string = req.params.origin || req.params.lte || req.params.gte || '';
    origin = this.isStringPublicKey(origin) ? origin : this.server.getWallet().getPublicKey();
    const a: Array<TxStruct> | undefined = await this.server.getChain().getRange(gte, lte, origin);
    return a ? res.json(a) : res.status(404).end();
  }

  private putTransaction(req: Request, res: Response): Response {
    return this.server.stackTx(req.body) ? res.status(200).end() : res.status(403).end();
  }

  private isStringPublicKey(s: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(s);
  }
}
