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
import { Bootstrap } from './bootstrap.ts';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { Wallet } from '../chain/wallet.ts';
import { Api } from './api.ts';
import type { Command } from '../chain/tx.ts';
import { TxFactory } from './tx-factory.ts';
import type { TxStruct } from '../chain/tx.ts';
import { Network } from './network.ts';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class Server {
  public readonly config: Config;

  private agent: SocksProxyAgent = {} as SocksProxyAgent;
  private webSocketServerTxFeed: WebSocketServer = {} as WebSocketServer;
  private txFactory: TxFactory = {} as TxFactory;
  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private chain: Chain = {} as Chain;
  private validation: Validation = {} as Validation;
  private api: Api = {} as Api;

  constructor(config: Config) {
    this.config = config;
    Log.info(`divachain ${this.config.VERSION} instantiating...`);
    this.config.is_testnet &&
      Log.warn('IMPORTANT: this is a test node (API is NOT protected)');
    (async () => await this.start())();
  }

  private async start(): Promise<Server> {
    Log.info(`HTTP endpoint ${this.config.http}`);
    Log.info(`UDP endpoint ${this.config.udp}`);

    this.agent = new SocksProxyAgent(
      `socks://${this.config.i2p_socks}`,
      {
        timeout: this.config.network_timeout_ms,
      },
    );
    Log.info(`Agent on socks://${this.config.i2p_socks}`);

    this.wallet = Wallet.make(this.config);
    this.chain = await Chain.make(this);

    //this.validation = Validation.make();
    //Log.info('Validation initialized');

    this.network = Network.make(this);
    this.txFactory = TxFactory.make(this);
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

    return new Promise((resolve): void => {
      this.network.once('ready', async (): Promise<void> => {
        this.bootstrap = Bootstrap.make(this);
        if (this.config.bootstrap) {
          // bootstrapping (entering the network)
          await this.bootstrap.syncWithNetwork();
          if (!this.chain.hasNetworkHttp(this.config.http)) {
            await this.bootstrap.joinNetwork(this.wallet.getPublicKey());
          }
        }
        resolve(this);
      });
    });
  }

  public async shutdown(): Promise<void> {
    typeof this.api.shutdown === 'function' && await this.api.shutdown();
    typeof this.network.shutdown === 'function' && this.network.shutdown();

    typeof this.txFactory.shutdown === 'function' && this.txFactory.shutdown();
    typeof this.chain.shutdown === 'function' && await this.chain.shutdown();
    typeof this.wallet.close === 'function' && this.wallet.close();
    typeof this.agent.destroy === 'function' && this.agent.destroy();
  }

  public getAgent(): SocksProxyAgent {
    return this.agent;
  }

  public getBootstrap(): Bootstrap {
    return this.bootstrap;
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

  public stackTx(commands: Array<Command>): boolean {
    return this.txFactory.stack(commands);
  }

  public queueWebSocketFeed(tx: TxStruct): void {
    setImmediate((tx: TxStruct): void => {
      this.webSocketServerTxFeed.clients.forEach(
        (ws: WebSocket) =>
          ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(tx)),
      );
    }, tx);
  }
}
