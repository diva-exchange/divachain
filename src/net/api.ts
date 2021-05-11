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
import { ArrayComand, Transaction, TransactionStruct } from '../chain/transaction';
import { Wallet } from '../chain/wallet';

export class Api {
  private server: Server;
  private readonly wallet: Wallet;

  constructor(server: Server, wallet: Wallet) {
    this.server = server;
    this.wallet = wallet;
  }

  public init(): Api {
    // catch all
    this.server.httpServer.route({
      method: '*',
      path: '/{any*}',
      handler: (request, h) => {
        return h.response('404 - Not Found').code(404);
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/peers',
      handler: (request, h) => {
        return h.response(this.server.network.peers());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/network',
      handler: (request, h) => {
        return h.response(this.server.network.network());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/gossip',
      handler: (request, h) => {
        return h.response(this.server.network.gossip());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/stack/transactions',
      handler: (request, h) => {
        return h.response(this.server.transactionPool.getStack());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/pool/transactions',
      handler: (request, h) => {
        return h.response(this.server.transactionPool.get());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/pool/blocks',
      handler: (request, h) => {
        return h.response(this.server.blockPool.get());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/pool/votes',
      handler: (request, h) => {
        return h.response(this.server.votePool.getAll());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/pool/commits',
      handler: (request, h) => {
        return h.response(this.server.commitPool.get());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/state/peers',
      handler: async (request, h) => {
        return h.response(await this.server.blockchain.getState().getPeers());
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/blocks',
      handler: async (request, h) => {
        return h.response(await this.server.blockchain.get(request.query.limit, request.query.gte, request.query.lte));
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/blocks/page/{page?}',
      handler: async (request, h) => {
        return h.response(await this.server.blockchain.getPage(request.params.page, request.query.size));
      },
    });

    this.server.httpServer.route({
      method: 'GET',
      path: '/transaction/{origin}/{ident}',
      handler: async (request, h) => {
        return h.response(await this.server.blockchain.getTransaction(request.params.origin, request.params.ident));
      },
    });

    this.server.httpServer.route({
      method: 'PUT',
      path: '/transaction/{ident?}',
      handler: async (request, h) => {
        const t: TransactionStruct = new Transaction(
          this.wallet,
          request.payload as ArrayComand,
          request.params.ident
        ).get();

        if (this.server.stackTransaction(t)) {
          return h.response(t);
        } else {
          return h.response().code(403);
        }
      },
    });

    this.server.httpServer.route({
      method: 'POST',
      path: '/peer/add',
      handler: (request, h) => {
        //@FIXME logging
        Logger.trace(request.payload.toString());
        return h.response().code(200);
      },
    });

    this.server.httpServer.route({
      method: 'POST',
      path: '/peer/remove',
      handler: (request, h) => {
        //@FIXME logging
        Logger.trace(request.payload.toString());
        return h.response().code(200);
      },
    });

    return this;
  }
}
