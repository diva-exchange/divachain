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

import { Server } from './server';
import { Request, Response } from 'express';
import { ArrayComand, Transaction, TransactionStruct } from '../chain/transaction';
import { Wallet } from '../chain/wallet';

export class Api {
  private server: Server;
  private readonly wallet: Wallet;

  constructor(server: Server, wallet: Wallet) {
    this.server = server;
    this.wallet = wallet;
    this.init();
  }

  private init() {
    this.server.app.get('/peers', (req: Request, res: Response) => {
      return res.json(this.server.network.peers());
    });

    this.server.app.get('/network', (req: Request, res: Response) => {
      return res.json(this.server.network.network());
    });

    this.server.app.get('/gossip', (req: Request, res: Response) => {
      return res.json(this.server.network.gossip());
    });

    this.server.app.get('/stack/transactions', (req: Request, res: Response) => {
      return res.json(this.server.transactionPool.getStack());
    });

    this.server.app.get('/pool/transactions', (req: Request, res: Response) => {
      return res.json(this.server.transactionPool.get());
    });

    this.server.app.get('/pool/blocks', (req: Request, res: Response) => {
      return res.json(this.server.blockPool.get());
    });

    this.server.app.get('/pool/votes', (req: Request, res: Response) => {
      return res.json(this.server.votePool.getAll());
    });

    this.server.app.get('/pool/commits', (req: Request, res: Response) => {
      return res.json(this.server.commitPool.get());
    });

    this.server.app.get('/state/peers', async (req: Request, res: Response) => {
      return res.json(await this.server.blockchain.getState().getPeers());
    });

    this.server.app.get('/blocks', async (req: Request, res: Response) => {
      return res.json(
        await this.server.blockchain.get(
          Number(req.query.limit || 0),
          Number(req.query.gte || 0),
          Number(req.query.lte || 0)
        )
      );
    });

    this.server.app.get('/blocks/page/:page?', async (req: Request, res: Response) => {
      return res.json(await this.server.blockchain.getPage(Number(req.params.page || 0), Number(req.query.size || 0)));
    });

    this.server.app.get('/transaction/:origin/:ident', async (req: Request, res: Response) => {
      return res.json(await this.server.blockchain.getTransaction(req.params.origin, req.params.ident));
    });

    this.server.app.put('/transaction/:ident?', async (req: Request, res: Response) => {
      const t: TransactionStruct = new Transaction(this.wallet, req.body as ArrayComand, req.params.ident).get();
      if (this.server.stackTransaction(t)) {
        return res.json(t);
      }
      return res.status(403).end();
    });

    this.server.app.post('/peer/add', (req: Request, res: Response) => {
      return res.json(req.body);
    });

    this.server.app.post('/peer/remove', (req: Request, res: Response) => {
      return res.json(req.body);
    });
  }
}
