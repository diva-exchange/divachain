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

import fs from 'fs';
import { Level } from 'level';
import path from 'path';
import { CommandAddPeer, CommandRemovePeer, CommandData, TxStruct } from './tx.js';
import { Server } from '../net/server.js';
import { Logger } from '../logger.js';
import { Util } from './util.js';

export type Peer = {
  publicKey: string;
  http: string;
  tcp: string;
  udp: string;
  stake: number;
};

export class Chain {
  public static readonly COMMAND_ADD_PEER: string = 'addPeer';
  public static readonly COMMAND_REMOVE_PEER: string = 'removePeer';
  public static readonly COMMAND_MODIFY_STAKE: string = 'modifyStake';
  public static readonly COMMAND_DATA: string = 'data';

  private readonly server: Server;
  private readonly publicKey: string;
  private readonly mapDbChain: Map<string, Level<string, any>>;
  private readonly dbState: Level<string, any>;
  private readonly dbPeer: Level<string, any>;

  private mapHeight: Map<string, number>; // origin -> height
  private mapTxs: Map<string, Map<number, TxStruct>>; // origin -> height
  private mapLatestTx: Map<string, TxStruct>;

  private mapLock: Map<string, number> = new Map();

  private mapPeer: Map<string, Peer>;
  private mapHttp: Map<string, string>;
  private mapTcp: Map<string, string>;
  private mapUdp: Map<string, string>;

  private countNodes: number;
  private stakeNodes: number;

  static async make(server: Server): Promise<Chain> {
    const c: Chain = new Chain(server);
    if (server.config.bootstrap) {
      await c.clear();
    } else {
      await c.init();
    }
    return c;
  }

  private constructor(server: Server) {
    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();

    this.mapDbChain = new Map();

    const pathDbState: string = path.join(this.server.config.path_state, this.publicKey);
    this.dbState = new Level(pathDbState, { valueEncoding: 'utf8', createIfMissing: true, errorIfExists: false });

    const pathDbPeer: string = path.join(this.server.config.path_state, this.publicKey + '-peer');
    this.dbPeer = new Level(pathDbPeer, { valueEncoding: 'json', createIfMissing: true, errorIfExists: false });

    this.mapHeight = new Map();
    this.mapTxs = new Map();
    this.mapLatestTx = new Map();

    this.mapPeer = new Map();
    this.mapHttp = new Map();
    this.mapTcp = new Map();
    this.mapUdp = new Map();

    this.countNodes = 0;
    this.stakeNodes = 0;
  }

  private async init(): Promise<void> {
    const aPeer: Array<CommandAddPeer> = await this.dbPeer.values().all();
    //@FIXME if the Peer database is corrupted (or deleted, or whatever)... the local data gets dumped!
    if (!aPeer.length) {
      await this.reset();
    }

    // load peers
    for (const commandAddPeer of aPeer) {
      try {
        await this.addPeer(commandAddPeer);
      } catch (error) {
        Logger.warn(`${this.server.config.port}: init/addPeer failed - ${commandAddPeer}`);
      }
    }

    await this.dbState.clear();
    for (const db of this.mapDbChain.values()) {
      for await (const value of db.values()) {
        const tx: TxStruct = value as TxStruct;
        this.updateCache(tx);
        await this.processState(tx);
      }
    }
  }

  private async reset(): Promise<void> {
    for (const [origin, db] of this.mapDbChain.entries()) {
      await db.clear();
      await db.close();
      this.mapDbChain.delete(origin);
    }

    const pathDb: string = path.join(this.server.config.path_chain, this.publicKey, this.publicKey);
    const dbChain: Level<string, any> = new Level(pathDb, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });

    const genesis: TxStruct = Chain.genesis(this.server.config.path_genesis);
    genesis.origin = this.publicKey;
    await dbChain.put(String(genesis.height).padStart(16, '0'), genesis);
    await dbChain.close();

    this.updateCache(genesis);
    await this.processState(genesis);
  }

  async shutdown(): Promise<void> {
    try {
      for (const db of this.mapDbChain.values()) {
        await db.close();
      }
      await this.dbState.close();
      await this.dbPeer.close();
    } catch (error) {
      //@FIXME error handling
      console.debug(error);
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

  async add(tx: TxStruct): Promise<void> {
    //@TODO validation here?
    if (!this.mapPeer.has(tx.origin)) {
      throw new Error(`Unknown peer: ${tx.origin}`);
    }

    if (this.mapLock.has(tx.origin)) {
      throw new Error(`Locked Chain: ${tx.origin} #${tx.height}`);
    }
    this.mapLock.set(tx.origin, tx.height);
    const dbChain: Level<string, any> | undefined = this.mapDbChain.get(tx.origin);
    if (dbChain) {
      await dbChain.put(String(tx.height).padStart(16, '0'), tx);
      this.updateCache(tx);
      await this.processState(tx);
    }
    this.mapLock.delete(tx.origin);
  }

  private updateCache(tx: TxStruct): void {
    this.mapHeight.set(tx.origin, tx.height);
    this.mapLatestTx.set(tx.origin, tx);

    // cache
    const mT: Map<number, TxStruct> = this.mapTxs.get(tx.origin) || new Map();
    mT.set(tx.height, tx);
    if (mT.size > this.server.config.chain_max_txs_in_memory) {
      mT.delete(tx.height - this.server.config.chain_max_txs_in_memory);
    }
    this.mapTxs.set(tx.origin, mT);
  }

  async getRange(gte: number, lte: number, origin: string): Promise<Array<TxStruct> | undefined> {
    const height: number | undefined = this.mapHeight.get(origin);
    const mT: Map<number, TxStruct> | undefined = this.mapTxs.get(origin);
    const db: Level<string, any> | undefined = this.mapDbChain.get(origin);
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
    gte = lte - gte >= this.server.config.api_max_query_size ? lte - this.server.config.api_max_query_size + 1 : gte;

    // cache available?
    if (mT.has(gte) && mT.has(lte)) {
      const start: number = mT.size - height + gte - 1;
      const end: number = start + lte - gte + 1;
      return [...mT.values()].slice(start, end);
    }

    const a: Array<TxStruct> = [];
    for await (const value of db.values({
      gte: String(gte).padStart(16, '0'),
      lte: String(lte).padStart(16, '0'),
    })) {
      a.push(value);
    }
    return a;
  }

  async getPage(page: number, size: number, origin: string): Promise<Array<TxStruct> | undefined> {
    const height: number | undefined = this.mapHeight.get(origin);
    if (!height) {
      return;
    }

    page = page < 1 ? 1 : Math.floor(page);
    size =
      size < 1 || size > this.server.config.api_max_query_size
        ? this.server.config.api_max_query_size
        : Math.floor(size);

    let gte: number = height - page * size + 1;
    if (gte + size - 1 < 1) {
      return [];
    }
    gte = gte < 1 ? 1 : gte;

    return this.getRange(gte, gte + size - 1, origin);
  }

  async search(q: string, origin: string): Promise<Array<TxStruct> | undefined> {
    // support only search strings with more than 2 characters
    const db: Level<string, any> | undefined = this.mapDbChain.get(origin);
    if (q.length < 3 || !db) {
      return;
    }

    const a: Array<TxStruct> = [];
    for await (const value of db.values({
      reverse: true,
      limit: this.server.config.api_max_query_size,
    })) {
      try {
        JSON.stringify(value).indexOf(q) > -1 && a.push(value);
      } catch (e) {
        Logger.warn(`${this.server.config.port}: ${e}`);
      }
    }
    return a.reverse();
  }

  async getTx(height: number, origin: string): Promise<TxStruct | undefined> {
    const mT: Map<number, TxStruct> | undefined = this.mapTxs.get(origin);
    const db: Level<string, any> | undefined = this.mapDbChain.get(origin);
    if (!mT || !db) {
      return;
    }

    try {
      // cache or db
      return mT.get(height) || ((await db.get(String(height).padStart(16, '0'))) as TxStruct);
    } catch (error) {
      return;
    }
  }

  async getState(key: string): Promise<{ key: string; value: string } | false> {
    return new Promise((resolve): void => {
      this.dbState.get(key, (error: Error | null | undefined, value: Buffer): void => {
        error ? resolve(false) : resolve({ key: key, value: value.toString() });
      });
    });
  }

  async searchState(search: string = ''): Promise<Array<{ key: string; value: any }>> {
    const a: Array<{ key: string; value: any }> = [];
    for await (const [key, value] of this.dbState.iterator({
      reverse: true,
      limit: this.server.config.api_max_query_size,
    })) {
      (!search.length || (key + value).indexOf(search) > -1) && a.push({ key: key, value: value });
    }
    return a;
  }

  // get latest local tx
  getLatestTx(origin: string): TxStruct | undefined {
    return this.mapLatestTx.get(origin);
  }

  getHeight(origin: string): number | undefined {
    return this.mapHeight.get(origin);
  }

  hasQuorum(size: number): boolean {
    return size > this.countNodes * (2 / 3);
  }

  getMapPeer(): Map<string, Peer> {
    return this.mapPeer;
  }

  getListPeer(): Array<string> {
    return [...this.mapPeer.keys()].sort();
  }

  hasPeer(publicKey: string): boolean {
    return this.mapPeer.has(publicKey);
  }

  getPeer(publicKey: string): Peer {
    return this.mapPeer.get(publicKey) as Peer;
  }

  hasNetworkHttp(http: string): boolean {
    return this.mapHttp.has(http);
  }

  async getPerformance(height: number): Promise<{ timestamp: number }> {
    let ts: number;
    try {
      ts = Number((await this.dbState.get('debug-performance-' + height)).toString());
    } catch (error) {
      ts = 0;
    }
    return { timestamp: ts };
  }

  static genesis(p: string): TxStruct {
    if (!fs.existsSync(p)) {
      throw new Error('Genesis Tx not found at: ' + p);
    }
    const tx: TxStruct = JSON.parse(fs.readFileSync(p).toString());
    tx.hash = Util.hash(tx);
    return tx;
  }

  private async processState(tx: TxStruct): Promise<void> {
    if (this.server.config.debug_performance) {
      await this.updateStateData(`debug-performance-${tx.origin}-${tx.height}`, new Date().getTime().toString());
    }

    for (const c of tx.commands) {
      switch (c.command) {
        case Chain.COMMAND_ADD_PEER:
          await this.addPeer(c as CommandAddPeer);
          break;
        case Chain.COMMAND_REMOVE_PEER:
          await this.removePeer(c as CommandRemovePeer);
          break;
        case Chain.COMMAND_MODIFY_STAKE:
          //TODO
          break;
        case Chain.COMMAND_DATA:
          await this.updateStateData([(c as CommandData).ns, tx.origin].join(':'), (c as CommandData).d);
          break;
      }
    }
  }

  //@FIXME trust the public key from the command?
  private async addPeer(command: CommandAddPeer): Promise<void> {
    if (this.mapPeer.has(command.publicKey)) {
      return;
    }

    const peer: Peer = {
      publicKey: command.publicKey,
      http: command.http,
      tcp: command.tcp,
      udp: command.udp,
      stake: 1,
    };
    this.countNodes++;
    this.stakeNodes = this.stakeNodes + peer.stake;

    this.mapPeer.set(command.publicKey, peer);
    this.mapHttp.set(peer.http, command.publicKey);
    this.mapTcp.set(peer.tcp, command.publicKey);
    this.mapUdp.set(peer.udp, command.publicKey);
    await this.dbPeer.put(command.publicKey, command);

    const pathDb: string = path.join(this.server.config.path_chain, this.publicKey, command.publicKey);
    const dbChain: Level<string, any> = new Level(pathDb, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });

    // load genesis
    const genesis: TxStruct = Chain.genesis(this.server.config.path_genesis);
    genesis.origin = command.publicKey;
    await dbChain.put(String(genesis.height).padStart(16, '0'), genesis);

    this.mapDbChain.set(command.publicKey, dbChain);
  }

  //@FIXME trust the public key from the command?
  private async removePeer(command: CommandRemovePeer): Promise<void> {
    // can't remove yourself
    if (command.publicKey === this.publicKey) {
      return;
    }

    if (!this.mapPeer.has(command.publicKey)) {
      return;
    }
    const peer: Peer = this.mapPeer.get(command.publicKey) as Peer;
    this.countNodes--;
    this.stakeNodes = this.stakeNodes - peer.stake;

    this.mapPeer.delete(command.publicKey);
    this.mapHttp.delete(peer.http);
    this.mapTcp.delete(peer.tcp);
    await this.dbPeer.del(command.publicKey);

    this.mapDbChain.delete(command.publicKey);
  }

  private async updateStateData(key: string, value: string): Promise<void> {
    await this.dbState.put(key, value);
  }
}
