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

import { Level } from 'level';
import path from 'node:path';
import { COMMAND_DATA, CommandData, TxStruct } from './tx.ts';
import { Server } from '../net/server.ts';
import { Log } from '../logger.ts';
import { Util } from './util.ts';

export type Peer = {
  publicKey: string;
  http: string;
  udp: string;
};

export class Chain {
  private readonly server: Server;
  private readonly publicKey: string;
  private readonly mapDbChain: Map<string, Level<string, TxStruct>>;
  private readonly dbState: Level<string, string>;
  private readonly dbPeer: Level<string, Peer>;

  private mapHeight: Map<string, number>; // origin -> height
  private mapTxs: Map<string, Map<number, TxStruct>>; // origin -> height
  private mapLatestTx: Map<string, TxStruct>;

  private mapLock: Map<string, number> = new Map();

  private mapPeer: Map<string, Peer>;
  private mapHttp: Map<string, string>;
  private mapUdp: Map<string, string>;

  private countNodes: number;

  public static async make(server: Server): Promise<Chain> {
    const c: Chain = new Chain(server);
    await c.init();
    Log.trace('Chain created');
    return c;
  }

  private constructor(server: Server) {
    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();

    this.mapDbChain = new Map();

    const pathDbState: string = path.join(
      this.server.config.path_state,
      this.publicKey,
    );
    this.dbState = new Level(pathDbState, {
      valueEncoding: 'utf8',
      createIfMissing: true,
      errorIfExists: false,
    });

    const pathDbPeer: string = path.join(
      this.server.config.path_state,
      this.publicKey + '-peer',
    );
    this.dbPeer = new Level(pathDbPeer, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });

    this.mapHeight = new Map();
    this.mapTxs = new Map();
    this.mapLatestTx = new Map();

    this.mapPeer = new Map();
    this.mapHttp = new Map();
    this.mapUdp = new Map();

    this.countNodes = 0;
  }

  private async init(): Promise<void> {
    const aPeer: Array<Peer> = await this.dbPeer.values().all();
    // FIXME if the Peer database is not available (corrupted, deleted...)
    // all the local data gets dumped!
    if (!aPeer.length) {
      await this.loadSeed();
    } else {
      for (const peer of aPeer) {
        try {
          await this.addPeer(peer);
        } catch (error) {
          Log.warn(
            `init/addPeer failed: ${JSON.stringify(error)} / ${
              JSON.stringify(peer)
            }`,
          );
        }
      }
    }

    await this.dbState.clear();
    Log.trace(`Running ${this.mapDbChain.size} databases...`);
    for (const [origin, db] of this.mapDbChain.entries()) {
      Log.trace(`Updating cache for database ${origin}`);
      for await (const tx of db.values()) {
        this.updateCache(tx);
        await this.processState(tx);
      }
    }

    this.getListPeer().filter((pk) => !this.getLatestTx(pk)).forEach(
      async (pk) => {
        // initialize a known peer
        Log.trace(`Creating genesis for peer ${pk}...`);
        // genesis TX are reproducable for any given public key
        // load genesis TX
        const genesis: TxStruct = await Chain.genesis(
          this.server.config.path_genesis,
        );
        // modify the genesis TX...
        genesis.o = pk;
        genesis.ha = Util.hash(genesis);
        await this.add(genesis);
      },
    );
  }

  private async loadSeed(): Promise<void> {
    let aPeer: Array<Peer> = [];
    // load seed peers from file
    try {
      Log.trace(`Loading peers from ${this.server.config.path_peer_seed}`);
      aPeer = JSON.parse(
        await Deno.readTextFile(this.server.config.path_peer_seed),
      );
    } catch (error: unknown) {
      throw error as Error;
    }

    // add myself
    aPeer.unshift({
      publicKey: this.publicKey,
      http: this.server.config.http,
      udp: this.server.config.udp,
    });
    aPeer.forEach(async (p: Peer) => {
      await this.addPeer(p);
    });
  }

  public async shutdown(): Promise<void> {
    try {
      for (const db of this.mapDbChain.values()) {
        await db.close();
      }
      await this.dbState.close();
      await this.dbPeer.close();
    } catch (error: unknown) {
      // FIXME error handling
      Log.error((error as Error).toString());
      return;
    }
  }

  private async clear(): Promise<void> {
    for (const db of this.mapDbChain.values()) {
      await db.clear();
    }
    await this.dbState.clear();
    await this.dbPeer.clear();

    this.mapHeight = new Map();
    this.mapTxs = new Map();
    this.mapLatestTx = new Map();
    this.mapPeer = new Map();
  }

  /**
   * Add a new transaction to a chain
   * @param tx TxStruct
   */
  public async add(tx: TxStruct): Promise<void> {
    // TODO validation here?
    if (!this.mapPeer.has(tx.o)) {
      throw new Error(`Unknown peer: ${tx.o}`);
    }

    if (this.mapLock.has(tx.o)) {
      throw new Error(`Locked Chain: ${tx.o} #${tx.h}`);
    }
    this.mapLock.set(tx.o, tx.h);
    const dbChain: Level<string, TxStruct> | undefined = this.mapDbChain.get(
      tx.o,
    );
    if (dbChain) {
      await dbChain.put(String(tx.h).padStart(16, '0'), tx);
      this.updateCache(tx);
      await this.processState(tx);
    }
    this.mapLock.delete(tx.o);
  }

  private updateCache(tx: TxStruct): void {
    this.mapHeight.set(tx.o, tx.h);
    this.mapLatestTx.set(tx.o, tx);

    // cache
    const mT: Map<number, TxStruct> = this.mapTxs.get(tx.o) || new Map();
    mT.set(tx.h, tx);
    if (mT.size > this.server.config.chain_max_txs_in_memory) {
      mT.delete(tx.h - this.server.config.chain_max_txs_in_memory);
    }
    this.mapTxs.set(tx.o, mT);
  }

  public async getRange(
    gte: number,
    lte: number,
    origin: string,
  ): Promise<Array<TxStruct> | undefined> {
    const height: number | undefined = this.mapHeight.get(origin);
    const mT: Map<number, TxStruct> | undefined = this.mapTxs.get(origin);
    const db: Level<string, TxStruct> | undefined = this.mapDbChain.get(origin);
    if (!height || !mT || !db) {
      return;
    }
    if (gte > height) {
      return [];
    }

    gte = gte < 1 ? 1 : Math.floor(gte);
    lte = lte < 0 ? gte : Math.floor(lte < 1 ? height : lte);
    lte = lte <= height ? lte : height;
    gte = lte - gte > 0 ? gte : lte;
    gte = lte - gte >= this.server.config.api_max_query_size
      ? lte - this.server.config.api_max_query_size + 1
      : gte;

    // cache available?
    if (mT.has(gte) && mT.has(lte)) {
      const start: number = mT.size - height + gte - 1;
      const end: number = start + lte - gte + 1;
      return [...mT.values()].slice(start, end);
    }

    const a: Array<TxStruct> = [];
    for await (
      const value of db.values({
        gte: String(gte).padStart(16, '0'),
        lte: String(lte).padStart(16, '0'),
      })
    ) {
      a.push(value);
    }
    return a;
  }

  public async getPage(
    page: number,
    size: number,
    origin: string,
  ): Promise<Array<TxStruct> | undefined> {
    const height: number | undefined = this.mapHeight.get(origin);
    if (!height) {
      return;
    }

    page = page < 1 ? 1 : Math.floor(page);
    size = size < 1 || size > this.server.config.api_max_query_size
      ? this.server.config.api_max_query_size
      : Math.floor(size);

    let gte: number = height - page * size + 1;
    if (gte + size - 1 < 1) {
      return [];
    }
    gte = gte < 1 ? 1 : gte;

    return await this.getRange(gte, gte + size - 1, origin);
  }

  public async search(
    q: string,
    origin: string,
  ): Promise<Array<TxStruct> | undefined> {
    // support only search strings with more than 2 characters
    const db: Level<string, TxStruct> | undefined = this.mapDbChain.get(origin);
    if (q.length < 3 || !db) {
      return;
    }

    const a: Array<TxStruct> = [];
    for await (
      const value of db.values({
        reverse: true,
        limit: this.server.config.api_max_query_size,
      })
    ) {
      try {
        JSON.stringify(value).indexOf(q) > -1 && a.push(value);
      } catch (e) {
        Log.warn(`${this.server.config.port}: ${e}`);
      }
    }
    return a.reverse();
  }

  public async getTx(
    height: number,
    origin: string,
  ): Promise<TxStruct | undefined> {
    const mT: Map<number, TxStruct> | undefined = this.mapTxs.get(origin);
    const db: Level<string, TxStruct> | undefined = this.mapDbChain.get(origin);
    if (!mT || !db) {
      return;
    }

    try {
      // cache or db
      return mT.get(height) ||
        ((await db.get(String(height).padStart(16, '0'))) as TxStruct);
    } catch (_error) {
      return;
    }
  }

  public async getState(
    key: string,
  ): Promise<{ key: string; value: string } | false> {
    const v = await this.dbState.get(key);
    return v === undefined
      ? Promise.resolve(false)
      : Promise.resolve({ key: key, value: v.toString() });
  }

  public async searchState(
    search: string = '',
  ): Promise<Array<{ key: string; value: string }>> {
    const a: Array<{ key: string; value: string }> = [];
    for await (
      const [key, value] of this.dbState.iterator({
        reverse: true,
        limit: this.server.config.api_max_query_size,
      })
    ) {
      (!search.length || (key + value).indexOf(search) > -1) &&
        a.push({ key: key, value: value });
    }
    return a;
  }

  // get latest local tx
  public getLatestTx(origin: string): TxStruct | undefined {
    return this.mapLatestTx.get(origin);
  }

  public getHeight(origin: string): number {
    return this.mapHeight.get(origin) || 0;
  }

  public getMapPeer(): Map<string, Peer> {
    return this.mapPeer;
  }

  public getListPeer(): Array<string> {
    return [...this.mapPeer.keys()].sort();
  }

  public hasPeer(publicKey: string): boolean {
    return this.mapPeer.has(publicKey);
  }

  // FIXME Peer might be an empty object
  /**
   * @param publicKey
   * @returns Peer
   */
  public getPeer(publicKey: string): Peer {
    return this.mapPeer.get(publicKey) || {} as Peer;
  }

  public hasNetworkHttp(http: string): boolean {
    return this.mapHttp.has(http);
  }

  public async getPerformance(height: number): Promise<{ timestamp: number }> {
    let ts: number;
    try {
      ts = Number(
        (await this.dbState.get('debug-performance-' + height)).toString(),
      );
    } catch (_error) {
      ts = 0;
    }
    return { timestamp: ts };
  }

  public static async genesis(p: string): Promise<TxStruct> {
    try {
      return JSON.parse(await Deno.readTextFile(p));
    } catch (error: unknown) {
      throw error as Error;
    }
  }

  private async processState(tx: TxStruct): Promise<void> {
    if (this.server.config.debug_performance) {
      await this.updateStateData(
        `debug-performance-${tx.o}-${tx.h}`,
        new Date().getTime().toString(),
      );
    }

    for (const c of tx.cs) {
      switch (c.c) {
        case COMMAND_DATA:
          await this.updateStateData(
            [(c as CommandData).ns, tx.o].join(':'),
            (c as CommandData).d,
          );
          break;
        default:
          // TODO
      }
    }
  }

  private async addPeer(peer: Peer): Promise<void> {
    if (this.mapPeer.has(peer.publicKey)) {
      return;
    }

    this.countNodes++;

    this.mapPeer.set(peer.publicKey, peer);
    this.mapHttp.set(peer.http, peer.publicKey);
    this.mapUdp.set(peer.udp, peer.publicKey);
    await this.dbPeer.put(peer.publicKey, peer);

    const pathDb: string = path.join(
      this.server.config.path_chain,
      peer.publicKey,
    );
    const dbChain: Level<string, TxStruct> = new Level(pathDb, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });
    this.mapDbChain.set(peer.publicKey, dbChain);
    Log.trace(`Added new peer ${peer.publicKey}`);
    Log.trace(`Knowing now ${this.countNodes} peers`);
  }

  // FIXME trust the public key from the command?
  private async removePeer(pk: string): Promise<void> {
    // can't remove yourself
    if (pk === this.publicKey) {
      return;
    }

    if (!this.mapPeer.has(pk)) {
      return;
    }
    const peer: Peer = this.mapPeer.get(pk) as Peer;
    this.countNodes--;

    this.mapPeer.delete(pk);
    this.mapHttp.delete(peer.http);
    await this.dbPeer.del(pk);

    this.mapDbChain.delete(pk);
  }

  private async updateStateData(key: string, value: string): Promise<void> {
    await this.dbState.put(key, value);
  }
}
