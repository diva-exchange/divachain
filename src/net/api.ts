/**
 * Copyright (C) 2022 diva.exchange
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

import { Server } from './server';
import { Request, Response } from 'express';
import { toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import { CommandRemovePeer } from '../chain/transaction';
import { Blockchain, Peer } from '../chain/blockchain';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet';

export class Api {
  private package: any = require('../../package.json');
  private server: Server;

  static make(server: Server) {
    return new Api(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.route();
  }

  private route() {
    this.server.app.get('/join/:http/:udp/:publicKey', (req: Request, res: Response) => {
      this.join(req, res);
    });
    this.server.app.get('/challenge/:token', (req: Request, res: Response) => {
      this.challenge(req, res);
    });
    this.server.app.get('/sync/:height', async (req: Request, res: Response) => {
      await this.sync(req, res);
    });
    this.server.app.get('/about', (req: Request, res: Response) => {
      this.about(res);
    });
    this.server.app.get('/testnet/token', async (req: Request, res: Response) => {
      return this.server.config.is_testnet
        ? res.json({ header: NAME_HEADER_TOKEN_API, token: this.server.getWallet().getTokenAPI() })
        : res.status(403).end();
    });

    this.server.app.get('/network/online', (req: Request, res: Response) => {
      this.networkOnline(res);
    });
    this.server.app.get('/network/:stake?', (req: Request, res: Response) => {
      this.network(req, res);
    });

    this.server.app.get('/state/search/:q?', async (req: Request, res: Response) => {
      await this.stateSearch(req, res);
    });
    this.server.app.get('/state/:key', async (req: Request, res: Response) => {
      await this.state(req, res);
    });

    this.server.app.get('/stack/stake', (req: Request, res: Response) => {
      this.stackModifyStake(res);
    });
    this.server.app.get('/stack', (req: Request, res: Response) => {
      this.stack(res);
    });

    this.server.app.get('/block/genesis', async (req: Request, res: Response) => {
      await this.blockGenesis(res);
    });
    this.server.app.get('/block/latest', (req: Request, res: Response) => {
      this.blockLatest(res);
    });
    this.server.app.get('/block/:height', async (req: Request, res: Response) => {
      await this.block(req, res);
    });

    this.server.app.get('/blocks/search/:q?', async (req: Request, res: Response) => {
      await this.blocksSearch(req, res);
    });
    this.server.app.get('/blocks/page/:page/:size?', async (req: Request, res: Response) => {
      await this.blocksPage(req, res);
    });
    this.server.app.get('/blocks/:gte?/:lte?', async (req: Request, res: Response) => {
      await this.blocks(req, res);
    });

    this.server.app.get('/transaction/:origin/:ident', async (req: Request, res: Response) => {
      await this.transaction(req, res);
    });
    this.server.app.put('/transaction/:ident?', async (req: Request, res: Response) => {
      req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
        ? await this.putTransaction(req, res)
        : res.status(401).end();
    });
    this.server.app.put('/leave', (req: Request, res: Response) => {
      req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
        ? this.leave(res)
        : res.status(401).end();
    });

    this.server.app.get('/debug/performance/:height', async (req: Request, res: Response) => {
      const height: number = Number(req.params.height || 0);
      return res.json(await this.server.getBlockchain().getPerformance(height));
    });
  }

  private join(req: Request, res: Response) {
    return this.server.getBootstrap().join(req.params.http, req.params.udp, req.params.publicKey)
      ? res
          .status(200)
          .json({ http: toB32(req.params.http), udp: toB32(req.params.udp), publicKey: req.params.publicKey })
      : res.status(403).end();
  }

  private leave(res: Response) {
    const ident: string | false = this.server.stackTx([
      {
        seq: 1,
        command: Blockchain.COMMAND_REMOVE_PEER,
        publicKey: this.server.getWallet().getPublicKey(),
      } as CommandRemovePeer,
    ]);
    if (ident) {
      return res.json({ ident: ident });
    }
    res.status(403).end();
  }

  private challenge(req: Request, res: Response) {
    const signedToken: string = this.server.getBootstrap().challenge(req.params.token);
    return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
  }

  private async sync(req: Request, res: Response) {
    const h: number = Math.floor(Number(req.params.height) || 0);
    return this.server.getBlockchain().getHeight() >= h
      ? res.json(await this.server.getBlockchain().getRange(h, h + this.server.config.network_sync_size))
      : res.status(404).end();
  }

  private about(res: Response) {
    return res.json({
      version: this.package.version,
      license: this.package.license,
      publicKey: this.server.getWallet().getPublicKey(),
      height: this.server.getBlockchain().getHeight(),
    });
  }

  private networkOnline(res: Response) {
    return res.json(this.server.getNetwork().getArrayOnline().sort());
  }

  private network(req: Request, res: Response) {
    const s: number = Math.floor(Number(req.params.stake) || 0);
    const a: Array<Peer> = this.server.getNetwork().getArrayNetwork();
    return res.json(s > 0 ? a.filter((r) => r['stake'] >= s) : a);
  }

  private async stateSearch(req: Request, res: Response) {
    try {
      return res.json(await this.server.getBlockchain().searchState(req.params.q || ''));
    } catch (error) {
      return res.status(404).end();
    }
  }

  private async state(req: Request, res: Response) {
    const key: string = req.params.key || '';
    const state: { key: string; value: string } | false = await this.server.getBlockchain().getState(key);
    return state ? res.json(state) : res.status(404).end();
  }

  private stack(res: Response) {
    return res.json(this.server.getBlockFactory().getStack());
  }

  private async blockGenesis(res: Response) {
    return res.json((await this.server.getBlockchain().getRange(1))[0]);
  }

  private blockLatest(res: Response) {
    return res.json(this.server.getBlockchain().getLatestBlock());
  }

  private async block(req: Request, res: Response) {
    const h: number = Math.floor(Number(req.params.height || 0));
    if (h < 1 || h > this.server.getBlockchain().getHeight()) {
      return res.status(404).end();
    }
    return res.json((await this.server.getBlockchain().getRange(h))[0]);
  }

  private async blocksSearch(req: Request, res: Response) {
    try {
      return res.json(await this.server.getBlockchain().searchBlocks(req.params.q || ''));
    } catch (error) {
      return res.status(404).end();
    }
  }

  private async blocksPage(req: Request, res: Response) {
    const page: number = Number(req.params.page || 1);
    const size: number = Number(req.params.size || 0);
    try {
      return res.json(await this.server.getBlockchain().getPage(page, size));
    } catch (error) {
      return res.status(404).end();
    }
  }

  private async blocks(req: Request, res: Response) {
    const gte: number = Math.floor(Number(req.params.gte || 1));
    const lte: number = Math.floor(Number(req.params.lte || 0));
    if (gte < 1) {
      return res.status(404).end();
    }
    try {
      return res.json(await this.server.getBlockchain().getRange(gte, lte));
    } catch (error) {
      return res.status(404).end();
    }
  }

  private async transaction(req: Request, res: Response) {
    const origin: string = req.params.origin || '';
    const ident: string = req.params.ident || '';
    if (!origin || !ident) {
      return res.status(404).end();
    }
    try {
      return res.json(await this.server.getBlockchain().getTransaction(origin, ident));
    } catch (error) {
      return res.status(404).end();
    }
  }

  private stackModifyStake(res: Response) {
    return res.json(this.server.getStackModifyStake());
  }

  private async putTransaction(req: Request, res: Response) {
    const ident: string | false = this.server.stackTx(req.body, req.params.ident);
    if (ident) {
      return res.json({ ident: ident });
    }
    res.status(403).end();
  }
}
