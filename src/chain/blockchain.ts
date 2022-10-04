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

import { BlockStruct } from './block';
import fs from 'fs';
import { Level } from 'level';
import path from 'path';
import {
  CommandAddPeer,
  CommandRemovePeer,
  CommandModifyStake,
  CommandData,
  CommandDecision,
  TransactionStruct,
} from './transaction';
import { Server } from '../net/server';
import { Logger } from '../logger';
import { Util } from './util';
import { STAKE_VOTE_AMOUNT, STAKE_VOTE_BLOCK_DISTANCE, STAKE_VOTE_IDENT } from '../config';

export type Peer = {
  publicKey: string;
  http: string;
  udp: string;
  stake: number;
};

export class Blockchain {
  public static readonly COMMAND_ADD_PEER = 'addPeer';
  public static readonly COMMAND_REMOVE_PEER = 'removePeer';
  public static readonly COMMAND_MODIFY_STAKE = 'modifyStake';
  public static readonly COMMAND_DATA = 'data';
  public static readonly COMMAND_DECISION = 'decision';
  public static readonly STATE_PEER_IDENT = 'peer:';

  private readonly server: Server;
  private readonly publicKey: string;
  private readonly dbBlockchain: Level<string, any>;
  private readonly dbState: Level<string, any>;

  private height: number = 0;
  private mapBlocks: Map<number, BlockStruct> = new Map();
  private latestBlock: BlockStruct = {} as BlockStruct;

  private mapPeer: Map<string, Peer> = new Map();
  private mapHttp: Map<string, string> = new Map();
  private mapUdp: Map<string, string> = new Map();

  private quorumWeighted: number = 0;
  private quorum: number = 0;

  private mapModifyStake: Map<string, Array<string>> = new Map();
  private mapVoteStake: Map<string, number> = new Map();

  private arrayDecision: { [ns: string]: Map<string, { stake: number; h: number; d: string }> } = {};
  private arrayTakenDecision: { [height: number]: Array<{ ns: string; d: string }> } = {};

  static async make(server: Server): Promise<Blockchain> {
    const b = new Blockchain(server);
    if (server.config.bootstrap) {
      await b.clear();
    } else {
      await b.init();
    }
    return b;
  }

  private constructor(server: Server) {
    this.server = server;
    this.publicKey = this.server.getWallet().getPublicKey();

    this.dbBlockchain = new Level(path.join(this.server.config.path_blockstore, this.publicKey), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });

    this.dbState = new Level(path.join(this.server.config.path_state, this.publicKey), {
      createIfMissing: true,
      errorIfExists: false,
      compression: true,
      cacheSize: 2 * 1024 * 1024, // 2 MB
    });
  }

  private async init() {
    this.height = 0;
    this.mapBlocks = new Map();
    this.latestBlock = {} as BlockStruct;
    await this.dbState.clear();

    for await (const value of this.dbBlockchain.values()) {
      const block: BlockStruct = JSON.parse(value) as BlockStruct;
      this.updateCache(block);
      await this.processState(block);
    }
  }

  async shutdown() {
    await this.dbBlockchain.close();
    await this.dbState.close();
  }

  async clear() {
    await this.dbBlockchain.clear();
    await this.dbState.clear();

    this.height = 0;
    this.mapBlocks = new Map();
    this.latestBlock = {} as BlockStruct;
    this.mapPeer = new Map();
  }

  async reset(genesis: BlockStruct) {
    await this.clear();
    await this.updateBlockData(String(1).padStart(16, '0'), JSON.stringify(genesis));
    await this.init();
  }

  add(block: BlockStruct): boolean {
    if (
      this.height + 1 !== block.height ||
      block.previousHash !== this.latestBlock.hash ||
      !this.server.getValidation().validateBlock(block)
    ) {
      return false;
    }
    this.updateCache(block);

    (async (b: BlockStruct) => {
      await this.updateBlockData(String(b.height).padStart(16, '0'), JSON.stringify(b));
      await this.processState(b);
    })(block);

    return true;
  }

  private updateCache(block: BlockStruct) {
    this.height = block.height;
    this.latestBlock = block;

    // cache
    this.mapBlocks.set(this.height, block);
    if (this.mapBlocks.size > this.server.config.blockchain_max_blocks_in_memory) {
      this.mapBlocks.delete(this.height - this.server.config.blockchain_max_blocks_in_memory);
    }

    // voting stake
    block.votes.forEach((v) => {
      this.mapVoteStake.set(v.origin, (this.mapVoteStake.get(v.origin) || 0) + 1);
    });
    if (this.mapVoteStake.size > 0) {
      if (this.height % STAKE_VOTE_BLOCK_DISTANCE === 0) {
        const vs = [...this.mapVoteStake.entries()].filter((a) => {
          return a[0] !== this.publicKey;
        });
        vs.sort((a, b) => (a[1] > b[1] ? -1 : a[1] === b[1] && a[0] > b[0] ? -1 : 1));
        this.server.proposeModifyStake(vs[0][0], STAKE_VOTE_IDENT, STAKE_VOTE_AMOUNT);
        this.mapVoteStake.delete(vs[0][0]);
      }
    }

    //@TODO review decisions
    /*
    // remove outdated decisions
    if (this.arrayTakenDecision[block.height - 1]) {
      this.arrayTakenDecision[block.height - 1].forEach(async (o) => {
        await this.deleteStateData(o.ns);
      });
      delete this.arrayTakenDecision[block.height - 1];
    }

    // decisions in cache
    block.tx.forEach((tx: TransactionStruct) => {
      tx.commands
        .filter((c) => c.command === Blockchain.COMMAND_DECISION)
        .forEach((c) => {
          if (!this.isDecisionTaken(c as CommandDecision)) {
            const height = (c as CommandDecision).h;
            const ns = (c as CommandDecision).ns;
            const data = (c as CommandDecision).d;
            const mapDecision = this.arrayDecision[ns] || new Map();

            mapDecision.set(tx.origin, {
              stake: this.getStake(tx.origin),
              h: height,
              d: data,
            });
            this.arrayDecision[ns] = mapDecision;

            if (
              [...mapDecision.values()]
                .filter((v) => v.h === height && v.d === data)
                .reduce((p, v) => p + v.stake, 0) >= this.getQuorumWeighted()
            ) {
              this.arrayTakenDecision[height]
                ? this.arrayTakenDecision[height].push({ ns: ns, d: data })
                : (this.arrayTakenDecision[height] = [{ ns: ns, d: data }]);
              delete this.arrayDecision[ns];
            }
          }
        });
    });
*/
  }

  async getRange(gte: number, lte: number = -1): Promise<Array<BlockStruct>> {
    gte = gte <= this.height ? (gte < 1 ? 1 : Math.floor(gte)) : this.height;
    lte = lte < 0 ? gte : Math.floor(lte < 1 ? this.height : lte);
    lte = lte <= this.height ? lte : this.height;
    gte = lte - gte > 0 ? gte : lte;
    gte = lte - gte >= this.server.config.api_max_query_size ? lte - this.server.config.api_max_query_size + 1 : gte;

    // cache available?
    if (this.mapBlocks.has(gte) && this.mapBlocks.has(lte)) {
      const start = this.mapBlocks.size - this.height + gte - 1;
      const end = start + lte - gte + 1;
      return [...this.mapBlocks.values()].slice(start, end);
    }

    const a: Array<BlockStruct> = [];
    for await (const value of this.dbBlockchain.values({
      gte: String(gte).padStart(16, '0'),
      lte: String(lte).padStart(16, '0'),
    })) {
      a.push(JSON.parse(value));
    }
    return a;
  }

  async getPage(page: number, size: number): Promise<Array<BlockStruct>> {
    page = page < 1 ? 1 : Math.floor(page);
    size =
      size < 1 || size > this.server.config.api_max_query_size
        ? this.server.config.api_max_query_size
        : Math.floor(size);

    let gte = this.height - page * size + 1;
    gte = gte < 1 ? 1 : gte;

    return this.getRange(gte, gte + size - 1);
  }

  async searchBlocks(search: string = ''): Promise<Array<BlockStruct>> {
    const a: Array<BlockStruct> = [];
    for await (const value of this.dbBlockchain.values({
      reverse: true,
      limit: this.server.config.api_max_query_size,
    })) {
      (!search.length || value.indexOf(search) > -1) && a.push(JSON.parse(value));
    }
    return a.reverse();
  }

  async getTransaction(origin: string, ident: string): Promise<{ height: number; transaction: TransactionStruct }> {
    // cache
    for await (const b of [...this.mapBlocks.values()]) {
      const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
      if (t) {
        return { height: b.height, transaction: t };
      }
    }

    // db
    for await (const value of this.dbBlockchain.values()) {
      const b = JSON.parse(value) as BlockStruct;
      const t = b.tx.find((t: TransactionStruct) => t.origin === origin && t.ident === ident);
      if (t) {
        return { height: b.height, transaction: t };
      }
    }

    throw new Error('Not Found');
  }

  async getState(key: string): Promise<{ key: string; value: string } | false> {
    return new Promise((resolve) => {
      this.dbState.get(key, (error, value: Buffer) => {
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

  getLatestBlock(): BlockStruct {
    return this.latestBlock;
  }

  getHeight(): number {
    return this.height;
  }

  getStake(publicKey: string): number {
    try {
      return this.getPeer(publicKey).stake;
    } catch (error) {
      return 0;
    }
  }

  getQuorum(): number {
    if (this.quorum <= 0) {
      throw new Error('Invalid quorum');
    }

    return this.quorum * (2 / 3); // PBFT
  }

  getQuorumWeighted(): number {
    if (this.quorumWeighted <= 0) {
      throw new Error('Invalid weighted quorum');
    }

    return this.quorumWeighted * 0.5; // PoS
  }

  getMapPeer(): Map<string, Peer> {
    return this.mapPeer;
  }

  hasPeer(publicKey: string): boolean {
    return this.mapPeer.has(publicKey);
  }

  getPeer(publicKey: string): Peer {
    return this.mapPeer.get(publicKey) as Peer;
  }

  getPublicKeyByUdp(udp: string): string {
    return this.mapUdp.get(udp) || '';
  }

  hasNetworkHttp(http: string): boolean {
    return this.mapHttp.has(http);
  }

  //@FIXME this is only considering the name space
  isDecisionTaken(c: CommandDecision): boolean {
    //@TODO this is in-memory
    return Object.values(this.arrayTakenDecision)
      .flat()
      .some((o) => o.ns === c.ns);
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

  static genesis(p: string): BlockStruct {
    if (!fs.existsSync(p)) {
      throw new Error('Genesis Block not found at: ' + p);
    }
    const b: BlockStruct = JSON.parse(fs.readFileSync(p).toString());
    b.hash = Util.hash([b.version, b.previousHash, JSON.stringify(b.tx), b.height].join());
    return b;
  }

  private async processState(block: BlockStruct) {
    if (this.server.config.debug_performance) {
      await this.updateStateData('debug-performance-' + this.height, new Date().getTime().toString());
    }

    for (const t of block.tx) {
      for (const c of t.commands) {
        switch (c.command) {
          case Blockchain.COMMAND_ADD_PEER:
            await this.addPeer(c as CommandAddPeer);
            break;
          case Blockchain.COMMAND_REMOVE_PEER:
            await this.removePeer(c as CommandRemovePeer);
            break;
          case Blockchain.COMMAND_MODIFY_STAKE:
            await this.modifyStake(t.origin, c as CommandModifyStake);
            break;
          case Blockchain.COMMAND_DATA:
            await this.updateStateData((c as CommandData).ns + ':' + t.origin, (c as CommandData).d);
            break;
          case Blockchain.COMMAND_DECISION:
            this.isDecisionTaken(c as CommandDecision) &&
              (await this.updateStateData(
                (c as CommandDecision).ns,
                JSON.stringify({ h: (c as CommandDecision).h, d: (c as CommandDecision).d })
              ));
            break;
        }
      }
    }
  }

  private async addPeer(command: CommandAddPeer) {
    if (this.mapPeer.has(command.publicKey)) {
      return;
    }

    const peer: Peer = {
      publicKey: command.publicKey,
      http: command.http,
      udp: command.udp,
      stake: 1,
    };
    this.quorum++;

    this.mapPeer.set(command.publicKey, peer);
    this.mapHttp.set(peer.http, command.publicKey);
    this.mapUdp.set(peer.udp, command.publicKey);
    await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake.toString());
  }

  private async removePeer(command: CommandRemovePeer) {
    if (!this.mapPeer.has(command.publicKey)) {
      return;
    }
    const peer: Peer = this.mapPeer.get(command.publicKey) as Peer;
    this.quorumWeighted = this.quorumWeighted - peer.stake;
    this.quorum--;

    this.mapPeer.delete(command.publicKey);
    this.mapHttp.delete(peer.http);
    this.mapUdp.delete(peer.udp);
    await this.deleteStateData(Blockchain.STATE_PEER_IDENT + command.publicKey);
  }

  private async modifyStake(origin: string, command: CommandModifyStake) {
    if (!this.mapPeer.has(command.publicKey) || command.publicKey === origin) {
      return;
    }

    // if voted for own node: the origin gets some credits
    command.publicKey === this.publicKey && this.server.incStakeCredit(origin);

    const i = [command.publicKey, command.ident, command.stake].join('');
    const a: Array<string> = this.mapModifyStake.get(i) || [];
    if (a.includes(origin)) {
      return;
    }

    a.push(origin);
    this.mapModifyStake.set(i, a);
    if (a.length < this.getQuorum()) {
      return;
    }
    this.mapModifyStake.delete(i);

    const peer: Peer = this.mapPeer.get(command.publicKey) as Peer;
    if (peer.stake + command.stake < 1) {
      command.stake = -1 * peer.stake;
    }
    this.quorumWeighted = this.quorumWeighted + command.stake;
    peer.stake = peer.stake + command.stake;
    this.mapPeer.set(command.publicKey, peer);
    await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake.toString());
  }

  private async updateBlockData(key: string, data: string) {
    try {
      await this.dbBlockchain.put(key, data);
    } catch (error: any) {
      Logger.warn(`Blockchain.updateBlockData() ${error.toString()}`);
    }
  }

  private async updateStateData(key: string, value: string) {
    try {
      await this.dbState.put(key, value);
    } catch (error: any) {
      Logger.warn(`Blockchain.updateStateData() ${error.toString()}`);
    }
  }

  private async deleteStateData(key: string) {
    try {
      await this.dbState.del(key);
    } catch (error: any) {
      Logger.warn(`Blockchain.updateStateData() ${error.toString()}`);
    }
  }
}
