/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Config } from '../config.ts';
import { Log } from '../logger.ts';
import { createServer, IncomingMessage, Server as HttpServer } from 'node:http';
import { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { Wallet } from '../chain/wallet.ts';
import { Api } from './api.ts';
import { ConsensusFactory } from './consensus-factory.ts';
import { SocFactory } from './soc-factory.ts';
import { ConsensusBlockStruct, SocBlockStruct } from '../chain/block.ts';
import { Network } from './network.ts';
import { SocSync } from './soc-sync.ts';
import { ConsensusSync } from './consensus-sync.ts';
import { Economics } from '../chain/economics.ts'; // ADDED: Import Economics
import type { ApiDebug } from '../debug/api-debug.ts';

export class Server {
  private httpServerFeed!: HttpServer;
  private wssSoc!: WebSocketServer;
  private wssConsensus!: WebSocketServer;
  private clientProxy!: Deno.HttpClient;

  private wallet!: Wallet;
  private validation!: Validation;
  private chain!: Chain;
  private network!: Network;
  private consensusFactory!: ConsensusFactory;
  private socFactory!: SocFactory;
  private api!: Api;
  private socSync!: SocSync;
  private consensusSync!: ConsensusSync;
  private apiDebug!: ApiDebug;

  constructor(public readonly config: Config) {
    Log.info(`divachain ${config.VERSION} instantiating...`);

    if (config.is_testnet) {
      Economics.IS_TESTNET = true;
      Log.warn(
        'IMPORTANT: this is a test node (API is NOT protected, Economics has test settings)',
      );
    }
  }

  public async init(): Promise<void> {
    this.wallet = await Wallet.make(this.config);
    Log.info(
      `HTTP endpoint ${this.wallet.getHttpAddress()}\nUDP endpoint ${this.wallet.getUdpAddress()}`,
    );

    this.validation = Validation.make();
    this.chain = await Chain.make(this);
    this.network = await Network.make(this);
    this.consensusFactory = ConsensusFactory.make(this);
    this.socFactory = SocFactory.make(this);
    this.api = Api.make(this);
    this.socSync = SocSync.make(this);
    this.consensusSync = ConsensusSync.make(this);

    // Setup HTTP & WebSocket Servers
    this.httpServerFeed = createServer();
    this.wssSoc = this.createWssServer('wssSoc');
    this.wssConsensus = this.createWssServer('wssConsensus');

    this.httpServerFeed.on(
      'upgrade',
      (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const pathname: string | undefined = request.url;

        if (pathname === '/soc') {
          this.wssSoc.handleUpgrade(
            request,
            socket,
            head,
            (ws: WebSocket): void => {
              this.wssSoc.emit('connection', ws, request);
            },
          );
        } else if (pathname === '/consensus') {
          this.wssConsensus.handleUpgrade(
            request,
            socket,
            head,
            (ws: WebSocket): void => {
              this.wssConsensus.emit('connection', ws, request);
            },
          );
        } else {
          socket.destroy();
        }
      },
    );

    this.httpServerFeed.listen(
      this.config.port_block_feed,
      this.config.ip,
      (): void => {
        Log.info(
          `WebSocket feeds listening on ${this.config.ip}:${this.config.port_block_feed} (Paths: /chain, /consensus)`,
        );
      },
    );

    this.clientProxy = Deno.createHttpClient({
      proxy: { url: `socks5://${this.config.i2p_socks}` },
    });
    Log.info(`Using socks5://${this.config.i2p_socks} as proxy`);

    this.socFactory.startDecoyLoop();

    if (this.config.is_testnet && this.config.port_api_debug > 0) {
      try {
        const { ApiDebug } = await import('../debug/api-debug.ts');
        this.apiDebug = ApiDebug.make(this);
        Log.info('Testnet detected: ApiDebug module loaded.');
      } catch (err) {
        Log.error({ err }, 'Failed to load ApiDebug module');
      }
    }
  }

  public async shutdown(): Promise<void> {
    await this.apiDebug?.shutdown();
    await this.api?.shutdown();
    await this.network?.shutdown();
    this.consensusFactory?.shutdown();
    await this.chain?.shutdown();
    this.wallet?.close();

    this.wssSoc?.close();
    this.wssConsensus?.close();
    this.httpServerFeed?.close();
  }

  // --- Getter Methods ---
  public getWallet = (): Wallet => this.wallet;
  public getChain = (): Chain => this.chain;
  public getValidation = (): Validation => this.validation;
  public getNetwork = (): Network => this.network;
  public getConsensusFactory = (): ConsensusFactory => this.consensusFactory;
  public getSocFactory = (): SocFactory => this.socFactory;
  public getSocSync = (): SocSync => this.socSync;
  public getConsensusSync = (): ConsensusSync => this.consensusSync;

  // --- WebSocket Feed Queueing ---
  public queueSocWebSocketFeed = (block: SocBlockStruct): void =>
    this.broadcastWs(this.wssSoc, block);
  public queueConsensusWebSocketFeed = (block: ConsensusBlockStruct): void =>
    this.broadcastWs(this.wssConsensus, block);

  private broadcastWs(wss: WebSocketServer, data: unknown): void {
    queueMicrotask((): void => {
      const msg: string = JSON.stringify(data);
      wss.clients.forEach((ws: WebSocket): void => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      });
    });
  }

  private createWssServer(logName: string): WebSocketServer {
    const wss: WebSocketServer = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
    });
    wss.on('connection', (ws: WebSocket): void => {
      ws.on('error', (error: Error): void => {
        Log.warn(`${logName}.error: ${error.message}`);
        ws.terminate();
      });
    });
    return wss;
  }

  public async fetchFromApi(
    urlString: string,
    retry: number = 3,
    customSignal?: AbortSignal,
  ): Promise<Response> {
    const r400: Response = new Response(null, { status: 400 });
    const r503: Response = new Response(null, { status: 503 });
    const url: URL = new URL(urlString);
    if (url.protocol !== 'http:' || !url.hostname.endsWith('.i2p')) {
      Log.warn(`fetchFromApi: Invalid URL ${urlString}`);
      return r400;
    }

    try {
      const timeoutSignal = AbortSignal.timeout(this.config.network_timeout_ms);
      const activeSignal = customSignal
        ? AbortSignal.any([customSignal, timeoutSignal])
        : timeoutSignal;

      // local-only telemetry - 250 is a rough estimate for the weight of a fetch
      this.getNetwork().addHttpTx(250);

      // fetch
      const r: Response = await fetch(url.toString(), {
        client: this.clientProxy,
        signal: activeSignal,
      });
      Log.trace(`fetchFromApi(${url.toString()}) - Status: ${r.status}`);

      if ((!r.ok || r.status === 202 || r.status === 204) && r.body) {
        await r.body.cancel();
      }
      return r;
    } catch (error: unknown) {
      Log.warn(
        `Error (retry #: ${retry}) fetchFromApi(${urlString}): ${
          (error as Error).message
        }`,
      );

      if (retry > 0) {
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 2000);
        });
        return this.fetchFromApi(urlString, retry - 1, customSignal);
      }
      return r503;
    }
  }
}
