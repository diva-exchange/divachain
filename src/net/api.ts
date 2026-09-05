/**
 * Copyright (C) 2022-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import denoJSON from '../../deno.json' with { type: 'json' };
import { Server } from './server.ts';
import {
  COMMAND_DATA,
  CommandData,
  ReputationEntry,
  SocBlockStruct,
  SocCommand,
} from '../chain/block.ts';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet.ts';
import { Chain } from '../chain/chain.ts';
import { Log } from '../logger.ts';
import { Hono } from '@hono/hono/tiny';
import { Context, Next } from '@hono/hono';
import { bodyLimit } from '@hono/hono/body-limit';
import { HTTPException } from '@hono/hono/http-exception';
import { decodeBase64Url } from '@std/encoding';
import { Namespace } from '../chain/namespace.ts';
import { Util } from '../chain/util.ts';
import { toB32 } from '@i2p/sam';
import { cors } from '@hono/hono/cors';
import { PEER_STATUS_GUEST } from './network.ts';
import { LIMIT_SOC_BYTES_SOFT } from '../config.ts';

const MAX_CONCURRENT_CHALLENGES: number = 50;

export class Api {
  private server: Server;
  private publicKey: string;
  private app: Hono;
  private httpServer: Deno.HttpServer;
  private activeChallenges: Set<string> = new Set();
  private activeSessionPk: string = '';

  static make(server: Server): Api {
    return new Api(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();

    this.app = new Hono({ strict: false });
    this.app.use('*', cors());

    const requireAuth = async (c: Context, next: Next) => {
      const token = c.req.header(NAME_HEADER_TOKEN_API) || '';
      if (!this.server.getWallet().validateTokenAndSlide(token)) {
        throw new HTTPException(401, {
          message: 'Vault locked or session expired',
        });
      }
      await next();
    };
    this.app.use('/identity/*', requireAuth);
    this.app.use('/local/block', requireAuth);

    // local-only telemetry
    this.app.use('*', async (c: Context, next) => {
      const reqSize = Number(c.req.header('content-length') || 0);
      this.server.getNetwork().addHttpRx(reqSize);
      await next();
      const resText = await c.res.clone().text();
      this.server.getNetwork().addHttpTx(resText.length);
    });

    this.app.onError((error: unknown, c: Context) => {
      const _err: HTTPException = error as HTTPException;
      Log.error(`API Error: ${_err.message || _err.status}`);
      return c.text(`${_err.status}`, _err.status);
    });
    this.app.notFound((c: Context) => c.text('Not Found', 404));

    this.route();

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
    this.app.get('/favicon.ico', (c: Context) => c.body(null, 204));
    this.app.get('/about', (c: Context) => this.about(c));

    // Core Synchronization
    this.app.get('/blocks/:height', async (c: Context) => await this.sync(c));

    // REST compliant Consensus Endpoints
    this.app.get(
      '/consensus/latest',
      (c: Context) => this.getLatestConsensus(c),
    );
    this.app.get(
      '/consensus/block/:epoch',
      async (c: Context) => await this.getConsensusBlock(c),
    );
    this.app.get(
      '/consensus/range/:start/:end',
      async (c: Context) => await this.getConsensusRange(c),
    );

    // Network Handshake (Replaces UDP TYPE_ADD_PEER)
    this.app.get('/network/introduce', (c: Context) => this.introduce(c));
    this.app.get(
      '/network/challenge/:nonce',
      (c: Context) => this.challenge(c),
    );

    // Network & State
    this.app.get('/network/status', (c: Context) => this.status(c));
    this.app.get(
      '/network/validators',
      async (c: Context) => await this.validators(c),
    );

    this.app.get(
      '/network/reputation/:epoch',
      async (c: Context) => await this.reputationByEpoch(c),
    );
    this.app.get('/network/reputation', (c: Context) => this.reputation(c));
    this.app.get('/network/broadcast', (c: Context) => this.broadcast(c));
    this.app.get('/network', (c: Context) => this.network(c));

    // Pillar 2 (Reputation/World State) Raw Access
    this.app.get(
      '/reputation/search',
      async (c: Context) => await this.searchReputationState(c),
    );
    this.app.get(
      '/reputation/state/:key',
      async (c: Context) => await this.getReputationState(c),
    );

    // Pillar 3 (SOC Index) Access
    this.app.get(
      '/index/search',
      async (c: Context) => await this.searchSocIndex(c),
    );
    this.app.get(
      '/index/:key',
      async (c: Context) => await this.getSocIndex(c),
    );
    this.app.get('/index', async (c: Context) => await this.searchSocIndex(c));

    // Single Block Retrieval
    this.app.get('/genesis', async (c: Context) => await this.getGenesis(c));
    this.app.get('/block/latest', (c: Context) => this.getLatest(c));
    this.app.get(
      '/block/:height',
      async (c: Context) => await this.getBlock(c),
    );

    // Unlocking the Wallet
    this.app.post('/keystore/unlock', async (c: Context) => {
      return await this.unlock(c);
    });

    this.app.post('/identity/request', (c: Context) => {
      const volatilePk = this.server.getWallet().requestVolatileIdentity();
      return c.json({ pk: volatilePk });
    });

    this.app.post('/identity/finalize', async (c: Context) => {
      return await this.finalizeIdentity(c);
    });

    this.app.put(
      '/local/block',
      bodyLimit({ maxSize: 65536 }),
      async (c: Context) => {
        return await this.putBlock(c);
      },
    );
  }

  private about(c: Context) {
    return c.json({ version: denoJSON.version, publicKey: this.publicKey });
  }

  private async sync(c: Context) {
    let rHeight: number = Math.floor(Number(c.req.param('height')));
    if (isNaN(rHeight) || rHeight <= 0) rHeight = 1;

    const pk: string = c.req.query('pk') || this.publicKey;
    if (!this.isStringPublicKey(pk)) throw new HTTPException(403);

    const [h, err] = this.server.getChain().getHeight(pk);
    if (err) return c.notFound();

    return h >= rHeight
      ? c.json(
        await this.server.getChain().getRange(
          rHeight,
          rHeight + this.server.config.network_sync_size,
          pk,
        ),
      )
      : c.notFound();
  }

  private async getConsensusBlock(c: Context) {
    const epoch = Math.floor(Number(c.req.param('epoch')));
    if (isNaN(epoch) || epoch <= 0) return c.notFound();

    const [block, err] = await this.server.getChain().getConsensusBlockByEpoch(
      epoch,
    );
    if (!err && block) return c.json(block);

    const proposal = this.server.getConsensusFactory().getBestConsensusBlock();
    if (proposal && proposal.e === epoch) {
      return c.json(proposal);
    }

    return c.notFound();
  }

  private async getConsensusRange(c: Context) {
    const start = Math.floor(Number(c.req.param('start')));
    const end = Math.floor(Number(c.req.param('end')));

    if (isNaN(start) || start <= 0 || isNaN(end) || end < start) {
      return c.notFound();
    }

    const limit = Math.min(
      end - start + 1,
      this.server.config.network_sync_size,
    );

    return c.json(
      await this.server.getChain().getConsensusRange(
        start,
        start + limit - 1,
      ),
    );
  }

  private introduce(c: Context) {
    const pk = c.req.query('pk');
    const http = c.req.query('http');
    const udp = c.req.query('udp');

    if (!pk || !http || !udp || !this.isStringPublicKey(pk)) {
      throw new HTTPException(400, { message: 'Bad Request' });
    }

    if (this.activeChallenges.size >= MAX_CONCURRENT_CHALLENGES) {
      return c.text('Too Many Requests', 429);
    }

    if (this.activeChallenges.has(pk) || this.activeChallenges.has(http)) {
      return c.text('Challenge already pending', 429);
    }

    this.activeChallenges.add(pk);
    this.activeChallenges.add(http);

    setTimeout(async () => {
      try {
        const nonce = Util.hashString(
          Date.now().toString() + Math.random().toString(),
        );
        const targetUrl = `http://${
          toB32(http)
        }.b32.i2p/network/challenge/${nonce}`;

        const r: Response = await this.server.fetchFromApi(targetUrl, 1);
        if (r.status === 200) {
          const payload = await r.json();
          if (
            payload && payload.sig &&
            Util.verifySignature(pk, payload.sig, nonce)
          ) {
            Log.info(`Introduce: Peer ${pk} passed cryptographic challenge.`);
            await this.server.getNetwork().addPeer({
              publicKey: pk,
              http,
              udp,
              status: PEER_STATUS_GUEST,
              joinedAtEpoch: this.server.getChain().getCurrentEpoch(),
            });
          }
        }
      } catch (err: unknown) {
        Log.trace(
          { err },
          `Introduce: Failed to complete challenge for peer ${pk}`,
        );
      } finally {
        this.activeChallenges.delete(pk);
        this.activeChallenges.delete(http);
      }
    }, 0);

    return c.body(null, 202);
  }

  private challenge(c: Context) {
    const nonce = c.req.param('nonce');
    if (!nonce || nonce.length > 128) return c.text('Bad Request', 400);

    const sig = this.server.getWallet().signNode(nonce);
    return c.json({ sig });
  }

  private network(c: Context) {
    return c.json(this.server.getNetwork().getArrayNetwork());
  }

  private broadcast(c: Context) {
    return c.json(this.server.getNetwork().getArrayBroadcast());
  }

  private status(c: Context) {
    const pk: string = c.req.query('pk') || '';
    if (pk && !this.isStringPublicKey(pk)) throw new HTTPException(403);
    return c.json(this.server.getNetwork().getStatus(pk));
  }

  private getLatestConsensus(c: Context) {
    const [block, err] = this.server.getChain().getLatestConsensusBlock();
    if (err) return c.notFound();
    return c.json(block);
  }

  private async validators(c: Context) {
    const epoch = this.server.getChain().getCurrentEpoch();
    if (epoch === 0) return c.notFound();

    const state = await this.server.getChain().getReputationState(
      Namespace.validatorsForEpoch(epoch),
    );
    if (!state) return c.notFound();

    try {
      return c.json(JSON.parse(state.value));
    } catch (_err: unknown) {
      return c.notFound();
    }
  }

  private async reputationByEpoch(c: Context) {
    const epoch: number = Math.floor(Number(c.req.param('epoch')));
    if (isNaN(epoch) || epoch <= 0) return c.notFound();

    const pk: string = c.req.query('pk') || '';
    if (pk && !this.isStringPublicKey(pk)) throw new HTTPException(403);

    const state = await this.server.getChain().getReputationState(
      Namespace.reputationForEpoch(epoch),
    );
    if (!state) return c.notFound();

    try {
      const reputationList: Array<ReputationEntry> = JSON.parse(state.value);
      if (pk) {
        const entry = reputationList.find((r: ReputationEntry) => r.pk === pk);
        return c.json(entry ? entry.r : 0);
      }
      return c.json(reputationList);
    } catch (_err: unknown) {
      return c.notFound();
    }
  }

  private async searchReputationState(c: Context) {
    return c.json(
      await this.server.getChain().searchReputationState(
        c.req.query('q') || '',
      ),
    );
  }

  private async getReputationState(c: Context) {
    const state = await this.server.getChain().getReputationState(
      c.req.param('key') || '',
    );
    return state ? c.json(state) : c.notFound();
  }

  private async reputation(c: Context) {
    const pk: string = c.req.query('pk') || '';
    if (pk && !this.isStringPublicKey(pk)) throw new HTTPException(403);

    const rep = await this.server.getChain().getLatestReputation(pk);
    return rep !== undefined ? c.json(rep) : c.notFound();
  }

  private async getGenesis(c: Context) {
    try {
      return c.json(
        await Chain.loadGenesis<SocBlockStruct>(
          this.server.config.path_genesis_soc,
        ),
      );
    } catch (e: unknown) {
      const err: Error = e as Error;
      throw new HTTPException(500, { message: `${err.message}` });
    }
  }

  private async getSocIndex(c: Context) {
    const indexData = await this.server.getChain().getSocIndex(
      c.req.param('key') || '',
    );
    return indexData
      ? c.json({ key: indexData.key, value: indexData.value })
      : c.notFound();
  }

  private async searchSocIndex(c: Context) {
    const results = await this.server.getChain().searchSocIndex(
      c.req.query('q') || '',
    );
    const dumbResults = results.map((r) => ({ key: r.key, value: r.value }));

    return c.json(dumbResults);
  }

  private getLatest(c: Context) {
    const pk: string = c.req.query('pk') || this.publicKey;
    if (!this.isStringPublicKey(pk)) throw new HTTPException(403);

    const [block, err] = this.server.getChain().getLatestSocBlock(pk);
    if (err || !block) return c.notFound();

    const dumbBlock: SocBlockStruct = {
      e: block.e,
      h: block.h,
      p: block.p,
      cs: block.cs,
      ha: block.ha,
      sig: block.sig,
    };

    return c.json(dumbBlock);
  }

  private async getBlock(c: Context) {
    const _pk: string = c.req.query('pk') || '';
    const pk: string = this.isStringPublicKey(_pk) ? _pk : this.publicKey;
    const height: number = Math.floor(Number(c.req.param('height')));

    if (isNaN(height) || height <= 0) return c.notFound();

    const block = await this.server.getChain().getSocBlock(height, pk);
    if (!block) return c.notFound();

    const dumbBlock: SocBlockStruct = {
      e: block.e,
      h: block.h,
      p: block.p,
      cs: block.cs,
      ha: block.ha,
      sig: block.sig,
    };

    return c.json(dumbBlock);
  }

  private async unlock(c: Context) {
    try {
      const body = await c.req.json();
      const unlockKeyBuf = decodeBase64Url(body.unlockKey);

      await this.server.getWallet().open(unlockKeyBuf);
      const token = this.server.getWallet().getTokenAPI();

      return c.json({ token, difficulty: Util.getIdentityPoWDifficulty() });
    } catch (e: unknown) {
      const err: Error = e as Error;
      throw new HTTPException(401, {
        message: `Invalid Unlock Key, ${err.message}`,
      });
    }
  }

  private async finalizeIdentity(c: Context) {
    let body;
    try {
      body = await c.req.json();
    } catch (e: unknown) {
      const err: Error = e as Error;
      throw new HTTPException(400, {
        message: `Malformed JSON payload, ${err.message}`,
      });
    }

    const { pk, nonce } = body;

    const isValid: boolean = await Util.verifyIdentityPoW(pk, nonce);
    if (!isValid) throw new HTTPException(403, { message: 'Invalid PoW' });

    try {
      this.server.getWallet().finalizeVolatileIdentity(pk);
      this.server.getWallet().saveCurrentKeystore();
      this.activeSessionPk = pk;

      const commands: Array<CommandData> = [{
        c: COMMAND_DATA,
        ns: Namespace.SYS_IDENTITY,
        d: nonce,
      }];

      const success = await this.server.getSocFactory().createLocalBlock(
        commands,
        pk,
      );
      if (!success) {
        throw new Error('SocFactory rejected the sys:identity block.');
      }
      return c.body(null, 204);
    } catch (error: unknown) {
      const e = error as Error;
      throw new HTTPException(500, {
        message: `Failed to finalize identity: ${e.message}`,
      });
    }
  }

  private async putBlock(c: Context) {
    let commands: Array<SocCommand>;
    try {
      commands = await c.req.json();
    } catch (e: unknown) {
      const err: Error = e as Error;
      throw new HTTPException(400, {
        message: `Bad Request: Malformed JSON payload, ${err.message}`,
      });
    }

    if (!Array.isArray(commands)) {
      throw new HTTPException(400, {
        message: 'Bad Request: Payload must be an array',
      });
    }

    const targetPk = this.activeSessionPk || this.publicKey;
    const currentBytes = this.server.getChain().getSocBytes(targetPk);

    if (currentBytes >= LIMIT_SOC_BYTES_SOFT) {
      throw new HTTPException(413, {
        message:
          'Payload Too Large: SOC Limit reached. Submit a prune/checkpoint block first.',
      });
    }

    if (
      await this.server.getSocFactory().createLocalBlock(commands, targetPk)
    ) {
      return c.body(null, 204);
    }
    throw new HTTPException(403, { message: 'Invalid Block' });
  }

  private isStringPublicKey(s: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(s);
  }
}
