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

import { Config } from '../config.ts';
import { Log } from '../logger.ts';
import { setImmediate } from 'node:timers';
import { WebSocket, WebSocketServer } from 'ws';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { Wallet } from '../chain/wallet.ts';
import { Api } from './api.ts';
import { TxFactory } from './tx-factory.ts';
import type { TxStruct } from '../chain/tx.ts';
import { Network } from './network.ts';

export class Server {
  public readonly config: Config;

  private webSocketServerTxFeed: WebSocketServer = {} as WebSocketServer;
  private txFactory: TxFactory = {} as TxFactory;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private chain: Chain = {} as Chain;
  private validation: Validation = {} as Validation;
  private api: Api = {} as Api;
  private clientProxy: Deno.HttpClient = {} as Deno.HttpClient;

  constructor(config: Config) {
    this.config = config;
    Log.info(`divachain ${this.config.VERSION} instantiating...`);
    this.config.is_testnet &&
      Log.warn('IMPORTANT: this is a test node (API is NOT protected)');
    (async () => await this.start())();
  }

  private async start(): Promise<void> {
    Log.info(`HTTP endpoint ${this.config.http}`);
    Log.info(`UDP endpoint ${this.config.udp}`);

    // First: independent modules
    this.wallet = Wallet.make(this.config);
    this.validation = Validation.make();

    // Core: create chain and network modules
    this.chain = await Chain.make(this);
    this.network = Network.make(this);

    // Then: the Transaction Factory depends on the Chain and Network
    this.txFactory = TxFactory.make(this);

    // Last: create API
    this.api = Api.make(this);

    // standalone Websocket Server to feed block updates
    this.webSocketServerTxFeed = new WebSocketServer({
      host: this.config.ip,
      port: this.config.port_tx_feed,
      perMessageDeflate: false,
    });
    this.webSocketServerTxFeed.on('connection', (ws: WebSocket): void => {
      ws.on('error', (error: Error): void => {
        Log.warn('WebSocketServerTxFeed.error: ' + error.toString());
        ws.terminate();
      });
    });
    this.webSocketServerTxFeed.on('close', (): void => {
      Log.info(
        `WebSocketServerTxFeed closing on ${this.config.ip}:${this.config.port_tx_feed}`,
      );
    });
    this.webSocketServerTxFeed.on('listening', (): void => {
      Log.info(
        `WebSocketServerTxFeed listening on ${this.config.ip}:${this.config.port_tx_feed}`,
      );
    });

    this.clientProxy = Deno.createHttpClient({
      proxy: {
        url: 'socks5://' + this.config.i2p_socks,
      },
    });
    Log.info(`Using socks5://${this.config.i2p_socks} as proxy`);
  }

  public async shutdown(): Promise<void> {
    typeof this.api.shutdown === 'function' && await this.api.shutdown();
    typeof this.network.shutdown === 'function' && this.network.shutdown();

    typeof this.txFactory.shutdown === 'function' && this.txFactory.shutdown();
    typeof this.chain.shutdown === 'function' && await this.chain.shutdown();
    typeof this.wallet.close === 'function' && this.wallet.close();
  }

  public getWallet(): Wallet {
    return this.wallet;
  }

  public getChain(): Chain {
    return this.chain;
  }

  public getValidation(): Validation {
    return this.validation;
  }

  public getNetwork(): Network {
    return this.network;
  }

  public getTxFactory(): TxFactory {
    return this.txFactory;
  }

  public queueWebSocketFeed(tx: TxStruct): void {
    setImmediate((tx: TxStruct): void => {
      this.webSocketServerTxFeed.clients.forEach(
        (ws: WebSocket) =>
          ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(tx)),
      );
    }, tx);
  }

  // TODO url might be anything, not only an API url...
  public async fetchFromApi(
    url: string,
    retry: number = 3,
  ): Promise<Response | false> {
    try {
      const r: Response = await fetch(url, {
        client: this.clientProxy,
        signal: AbortSignal.timeout(this.config.network_timeout_ms),
      });
      Log.trace(`Server.fetchFromApi(${url}) - Status: ${r.status}`);
      return r;
    } catch (error) {
      Log.warn(
        `Error (retry #: ${retry}) Server.fetchFromApi(${url}): ${error}`,
      );
      return retry > 0 ? this.fetchFromApi(url, retry - 1) : false;
    }
  }
}
