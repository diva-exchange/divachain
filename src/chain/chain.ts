/**
 * Copyright (C) 2022-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Level } from 'level';
import path from 'node:path';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  CommandData,
  CommandReputation,
  CommandValidators,
  ConsensusBlockStruct,
  ReputationEntry,
  SocBlockStruct,
} from './block.ts';
import { Namespace } from './namespace.ts';
import { Server } from '../net/server.ts';
import { Log } from '../logger.ts';
import { Util } from './util.ts';
import { LIMIT_SOC_BYTES_HARD } from '../config.ts';

type KV = { key: string; value: string };
type aKV = Array<{ key: string; value: string }>;

export class Chain {
  private readonly server: Server;
  private readonly nodeId: string;
  private readonly primarySoc: string;

  private readonly mapDbSoc: Map<string, Level<string, SocBlockStruct>>;
  private mapHeight: Map<string, number>;
  private mapSocBlocks: Map<string, Map<number, SocBlockStruct>>;
  private mapLatestSocBlock: Map<string, SocBlockStruct>;
  private readonly mapSocBytes: Map<string, number> = new Map();
  private readonly mapSocQueue: Map<string, Promise<void>> = new Map();

  private dbConsensus: Level<string, ConsensusBlockStruct> = {} as Level<
    string,
    ConsensusBlockStruct
  >;
  private mapConsensusBlocks: Map<number, ConsensusBlockStruct>;
  private latestConsensusBlock: ConsensusBlockStruct | null = null;
  private consensusQueue: Promise<void> = Promise.resolve();

  private dbReputation: Level<string, string> = {} as Level<
    string,
    string
  >;

  private dbSocIndex: Level<string, string> = {} as Level<
    string,
    string
  >;

  public static async make(server: Server): Promise<Chain> {
    const c: Chain = new Chain(server);
    await c.init();
    return c;
  }

  private constructor(server: Server) {
    this.server = server;

    this.nodeId = this.server.getWallet().getNodePublicKey();
    this.primarySoc = this.server.getWallet().getPublicKey();

    this.mapDbSoc = new Map();
    this.mapHeight = new Map();
    this.mapSocBlocks = new Map();
    this.mapLatestSocBlock = new Map();
    this.mapConsensusBlocks = new Map();
  }

  private async init(): Promise<void> {
    this.dbConsensus = new Level(this.server.config.path_consensus, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });
    await this.dbConsensus.open();

    this.dbReputation = new Level(this.server.config.path_reputation, {
      valueEncoding: 'utf8',
      createIfMissing: true,
      errorIfExists: false,
    });
    await this.dbReputation.open();

    const pathDbSocIndex: string = path.join(
      this.server.config.path_soc_index,
      'namespaces',
    );
    this.dbSocIndex = new Level(pathDbSocIndex, {
      valueEncoding: 'utf8',
      createIfMissing: true,
      errorIfExists: false,
    });
    await this.dbSocIndex.open();
    await this.dbSocIndex.clear();
    await this.addSoc(this.nodeId);

    const localSocs = this.server.getWallet().getAllSocs();
    for (const soc of localSocs) {
      await this.addSoc(soc.publicKey);
    }

    await this.initConsensusStore();
  }

  private async initConsensusStore(): Promise<void> {
    const isEmpty =
      (await this.dbConsensus.keys({ limit: 1 }).all()).length === 0;

    if (isEmpty) {
      if (this.server.config.path_genesis_consensus) {
        Log.info('Consensus store empty. Loading local genesis block...');
        const genesis = await Chain.loadGenesis<ConsensusBlockStruct>(
          this.server.config.path_genesis_consensus,
        );
        await this.addConsensusBlock(genesis);
      } else {
        Log.info(
          'Consensus store empty. Awaiting Trust Anchor via P2P sync...',
        );
      }
    } else {
      Log.trace('Updating cache for consensus store...');
      for await (const block of this.dbConsensus.values()) {
        this.updateConsensusCache(block);

        const stateKey = Namespace.validatorsForEpoch(block.e);
        const hasState = await this.getReputationState(stateKey);
        if (!hasState) {
          await this.processConsensusState(block);
        }
      }
    }
  }

  public async shutdown(): Promise<void> {
    try {
      for (const db of this.mapDbSoc.values()) {
        await db.close();
      }
      await this.dbConsensus.close();
      await this.dbReputation.close();
      await this.dbSocIndex.close();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      Log.error({ err }, 'shutdown() failed');
    }
  }

  public async getConsensusBlockByEpoch(
    epoch: number,
  ): Promise<[ConsensusBlockStruct | null, Error | null]> {
    if (epoch < 1) {
      return [null, new Error(`Invalid epoch: ${epoch}`)];
    }

    const cached = this.mapConsensusBlocks.get(epoch);
    if (cached) return [cached, null];

    try {
      const block = await this.dbConsensus.get(String(epoch).padStart(16, '0'));
      if (block === undefined) {
        return [
          null,
          new Error(`Consensus block for epoch ${epoch} not found`),
        ];
      }
      return [block, null];
    } catch (e: unknown) {
      return [null, e instanceof Error ? e : new Error(String(e))];
    }
  }

  public addConsensusBlock(block: ConsensusBlockStruct): Promise<void> {
    this.consensusQueue = this.consensusQueue.then(async () => {
      const currentEpoch = this.getCurrentEpoch();
      if (block.e <= currentEpoch) return;

      if (
        this.latestConsensusBlock && block.p !== this.latestConsensusBlock.ha
      ) {
        Log.error(
          `CRITICAL: Chain break rejected in DB! Expected prev: ${this.latestConsensusBlock.ha}, got: ${block.p}`,
        );
        return;
      }

      await this.dbConsensus.put(String(block.e).padStart(16, '0'), block);
      this.updateConsensusCache(block);
      await this.processConsensusState(block);
      Log.trace(`New consensus block for epoch #${block.e}`);
    }).catch((err) => {
      Log.error({ err }, `Failed to add consensus block for epoch #${block.e}`);
    });

    return this.consensusQueue;
  }

  private updateConsensusCache(block: ConsensusBlockStruct): void {
    this.latestConsensusBlock = block;

    this.mapConsensusBlocks.set(block.e, block);
    if (
      this.mapConsensusBlocks.size >
        this.server.config.chain_max_blocks_in_memory
    ) {
      this.mapConsensusBlocks.delete(
        block.e - this.server.config.chain_max_blocks_in_memory,
      );
    }
  }

  public getCurrentEpoch(): number {
    return this.latestConsensusBlock ? this.latestConsensusBlock.e : 0;
  }

  public getLatestConsensusBlock(): [ConsensusBlockStruct, null] | [
    null,
    Error,
  ] {
    if (!this.latestConsensusBlock) {
      return [null, new Error('No consensus block available')];
    }
    return [this.latestConsensusBlock, null];
  }

  public async getConsensusRange(
    gte: number,
    lte: number,
  ): Promise<Array<ConsensusBlockStruct>> {
    const currentEpoch = this.getCurrentEpoch();
    if (currentEpoch === 0 || gte > currentEpoch) return [];

    gte = gte < 1 ? 1 : Math.floor(gte);
    lte = lte < 0 ? gte : Math.floor(lte < 1 ? currentEpoch : lte);
    lte = lte <= currentEpoch ? lte : currentEpoch;
    gte = lte - gte > 0 ? gte : lte;
    gte = lte - gte >= this.server.config.api_max_query_size
      ? lte - this.server.config.api_max_query_size + 1
      : gte;

    const a: Array<ConsensusBlockStruct> = [];
    for await (
      const value of this.dbConsensus.values({
        gte: String(gte).padStart(16, '0'),
        lte: String(lte).padStart(16, '0'),
      })
    ) a.push(value);
    return a;
  }

  public addSocBlock(origin: string, block: SocBlockStruct): Promise<void> {
    const queue: Promise<void> = this.mapSocQueue.get(origin) ||
      Promise.resolve();

    const nextTask = queue.then(async () => {
      const dbSoc = this.mapDbSoc.get(origin);
      if (!dbSoc) throw new Error('Database not found'); // <- Statt stummem return

      const [currentHeight] = this.getHeight(origin);
      if (block.h <= currentHeight) return;

      await dbSoc.put(String(block.h).padStart(16, '0'), block);
      this.updateSocCache(origin, block);
      await this.processSocIndex(origin, block);

      const blockBytes = new TextEncoder().encode(JSON.stringify(block)).length;
      const currentBytes = this.mapSocBytes.get(origin) || 0;
      const newTotal = currentBytes + blockBytes;
      this.mapSocBytes.set(origin, newTotal);

      if (newTotal > LIMIT_SOC_BYTES_HARD) {
        await this.enforceFifoPruning(origin, dbSoc);
      }
      Log.trace(`New chain block #${block.h} on chain ${origin}`);
    });

    this.mapSocQueue.set(origin, nextTask.catch(() => {}));

    return nextTask;
  }

  public async addSoc(publicKey: string): Promise<void> {
    if (this.mapDbSoc.has(publicKey)) {
      return;
    }

    const pathDbSoc: string = path.join(this.server.config.path_soc, publicKey);
    const dbSoc: Level<string, SocBlockStruct> = new Level(pathDbSoc, {
      valueEncoding: 'json',
      createIfMissing: true,
      errorIfExists: false,
    });
    await dbSoc.open();
    this.mapDbSoc.set(publicKey, dbSoc);

    const isEmpty = (await dbSoc.keys({ limit: 1 }).all()).length === 0;

    if (isEmpty) {
      Log.trace(`Creating genesis for peer chain ${publicKey}...`);
      const genesis = await Chain.loadGenesis<SocBlockStruct>(
        this.server.config.path_genesis_soc,
      );
      (genesis.cs[0] as CommandData).d = publicKey;
      genesis.ha = Util.hash(genesis);
      await this.addSocBlock(publicKey, genesis);
    } else {
      Log.trace(`Loading existing chain for peer ${publicKey}...`);

      let totalBytes = 0;
      for await (const value of dbSoc.values()) {
        totalBytes += new TextEncoder().encode(JSON.stringify(value)).length;
      }
      this.mapSocBytes.set(publicKey, totalBytes);

      const recentBlocks = await dbSoc.values({
        reverse: true,
        limit: this.server.config.chain_max_blocks_in_memory,
      }).all();

      for (const block of recentBlocks.reverse()) {
        this.updateSocCache(publicKey, block);
        await this.processSocIndex(publicKey, block);
      }
    }
  }

  public removeSoc(publicKey: string) {
    this.mapSocQueue.delete(publicKey);
    this.mapHeight.delete(publicKey);
    this.mapLatestSocBlock.delete(publicKey);
    this.mapSocBlocks.delete(publicKey);
    this.mapSocBytes.delete(publicKey);
    this.mapDbSoc.delete(publicKey);
  }

  private updateSocCache(origin: string, block: SocBlockStruct): void {
    this.mapHeight.set(origin, block.h);
    this.mapLatestSocBlock.set(origin, block);

    const mT: Map<number, SocBlockStruct> = this.mapSocBlocks.get(origin) ||
      new Map();
    mT.set(block.h, block);
    if (mT.size > this.server.config.chain_max_blocks_in_memory) {
      mT.delete(block.h - this.server.config.chain_max_blocks_in_memory);
    }
    this.mapSocBlocks.set(origin, mT);
  }

  public getSocBytes(origin: string): number {
    return this.mapSocBytes.get(origin) || 0;
  }

  public async getRange(
    gte: number,
    lte: number,
    origin: string,
  ): Promise<Array<SocBlockStruct>> {
    const height: number | undefined = this.mapHeight.get(origin);
    const mT: Map<number, SocBlockStruct> | undefined = this.mapSocBlocks.get(
      origin,
    );
    const db: Level<string, SocBlockStruct> | undefined = this.mapDbSoc.get(
      origin,
    );

    if (!height || !mT || !db || gte > height) return [];

    gte = gte < 1 ? 1 : Math.floor(gte);
    lte = lte < 0 ? gte : Math.floor(lte < 1 ? height : lte);
    lte = lte <= height ? lte : height;
    gte = lte - gte > 0 ? gte : lte;
    gte = lte - gte >= this.server.config.api_max_query_size
      ? lte - this.server.config.api_max_query_size + 1
      : gte;

    if (mT.has(gte) && mT.has(lte)) {
      const start: number = mT.size - height + gte - 1;
      const end: number = start + lte - gte + 1;
      return [...mT.values()].slice(start, end);
    }

    const a: Array<SocBlockStruct> = [];
    for await (
      const value of db.values({
        gte: String(gte).padStart(16, '0'),
        lte: String(lte).padStart(16, '0'),
      })
    ) a.push(value);
    return a;
  }

  public async getSocBlock(
    height: number,
    origin?: string,
  ): Promise<SocBlockStruct | undefined> {
    origin = origin || this.primarySoc;
    const mT: Map<number, SocBlockStruct> | undefined = this.mapSocBlocks.get(
      origin,
    );
    const db: Level<string, SocBlockStruct> | undefined = this.mapDbSoc.get(
      origin,
    );
    if (!mT || !db) return;

    try {
      const block = mT.get(height) ||
        ((await db.get(String(height).padStart(16, '0'))) as SocBlockStruct);
      return block;
    } catch (e: unknown) {
      Log.warn(
        { err: e, height: height, origin: origin },
        `getSocBlock() failed`,
      );
      return undefined;
    }
  }

  public getLatestSocBlock(
    origin?: string,
  ): [SocBlockStruct, null] | [null, Error] {
    origin = origin || this.primarySoc;
    const block: SocBlockStruct | undefined = this.mapLatestSocBlock.get(
      origin,
    );
    if (!block) {
      return [null, new Error('No chain block available for origin ' + origin)];
    }
    return [block, null];
  }

  public getHeight(origin?: string): [number, null] | [0, Error] {
    origin = origin || this.primarySoc;
    const h: number | undefined = this.mapHeight.get(origin);
    if (!h) return [0, new Error(`getHeight(${origin}) No height available`)];
    return [h, null];
  }

  public async getReputationState(key: string): Promise<KV | false> {
    const v: string | undefined = await this.dbReputation.get(key);
    return v === undefined
      ? Promise.resolve(false)
      : Promise.resolve({ key: key, value: v.toString() });
  }

  public async searchReputationState(search: string): Promise<aKV> {
    const a: aKV = [];
    let c: number = 0;
    for await (
      const [key, value] of this.dbReputation.iterator({ reverse: true })
    ) {
      if ((!search.length || (key + value).indexOf(search) > -1)) {
        a.push({ key: key, value: value });
        c++;
      }
      if (c === this.server.config.api_max_query_size) break;
    }
    return a;
  }

  public async getLatestReputation(
    origin?: string,
  ): Promise<Array<ReputationEntry> | number | undefined> {
    const epoch = this.getCurrentEpoch();
    if (epoch === 0) return undefined;

    const state = await this.getReputationState(
      Namespace.reputationForEpoch(epoch),
    );
    if (!state) return undefined;

    try {
      const reputationList: Array<ReputationEntry> = JSON.parse(state.value);
      if (origin) {
        const entry: ReputationEntry | undefined = reputationList.find((r) =>
          r.pk === origin
        );
        return entry ? entry.r : 0;
      }
      return reputationList;
    } catch (_e) {
      return undefined;
    }
  }

  private async processConsensusState(
    block: ConsensusBlockStruct,
  ): Promise<void> {
    let hasReputationCmd = false;

    for (const c of block.cs) {
      switch (c.c) {
        case COMMAND_VALIDATORS: {
          const command = c as CommandValidators;
          await this.dbReputation.put(
            Namespace.validatorsForEpoch(block.e),
            JSON.stringify(command.d),
          );
          break;
        }
        case COMMAND_REPUTATION: {
          hasReputationCmd = true;
          const command = c as CommandReputation;
          const prevRepState = await this.getReputationState(
            Namespace.reputationForEpoch(block.e - 1),
          );
          const repMap = new Map<string, number>();

          if (prevRepState) {
            try {
              const parsed: Array<ReputationEntry> = JSON.parse(
                prevRepState.value,
              );
              parsed.forEach((item) => repMap.set(item.pk, item.r));
            } catch (_e) { /* ignore */ }
          }

          for (const delta of command.d) {
            if (delta.r !== undefined) {
              if (delta.r > 0) repMap.set(delta.pk, delta.r);
              else repMap.delete(delta.pk);
            }
          }

          const consolidated: Array<ReputationEntry> = [...repMap.entries()]
            .map(([pk, r]) => ({ pk, r }))
            .sort((a, b) => (a.pk > b.pk ? 1 : -1));

          await this.dbReputation.put(
            Namespace.reputationForEpoch(block.e),
            JSON.stringify(consolidated),
          );
          break;
        }
        default: {
          const unknownCmd = c as { c?: string };
          Log.warn(`Unknown consensus command: ${unknownCmd.c}`);
          break;
        }
      }
    }

    if (!hasReputationCmd) {
      if (block.e > 1) {
        const prevRepState = await this.getReputationState(
          Namespace.reputationForEpoch(block.e - 1),
        );
        await this.dbReputation.put(
          Namespace.reputationForEpoch(block.e),
          prevRepState ? prevRepState.value : '[]',
        );
      } else {
        await this.dbReputation.put(
          Namespace.reputationForEpoch(block.e),
          '[]',
        );
      }
    }
  }

  public async getSocIndex(
    key: string,
  ): Promise<KV | false> {
    const v: string | undefined = await this.dbSocIndex.get(key);
    return v === undefined
      ? Promise.resolve(false)
      : Promise.resolve({ key: key, value: v.toString() });
  }

  public async searchSocIndex(
    search: string,
    limitOverride?: number,
  ): Promise<aKV> {
    const a: aKV = [];
    let c: number = 0;
    const max: number = limitOverride !== undefined
      ? limitOverride
      : this.server.config.api_max_query_size;

    for await (
      const [key, value] of this.dbSocIndex.iterator({ reverse: true })
    ) {
      if (!search.length || (key + value).indexOf(search) > -1) {
        a.push({ key: key, value: value });
        c++;
        if (max !== -1 && c >= max) break;
      }
    }
    return a;
  }

  private async processSocIndex(
    origin: string,
    block: SocBlockStruct,
  ): Promise<void> {
    for (const c of block.cs) {
      switch (c.c) {
        case COMMAND_DATA:
          await this.dbSocIndex.put(
            [(c as CommandData).ns, origin].join(':'),
            (c as CommandData).d,
          );
          break;
        default:
          Log.warn(`Unknown chain command: ${c.c}`);
      }
    }
  }

  public static async loadGenesis<T>(p: string): Promise<T> {
    return JSON.parse(await Deno.readTextFile(p)) as T;
  }

  private async enforceFifoPruning(
    origin: string,
    db: Level<string, SocBlockStruct>,
  ): Promise<void> {
    const iterator = db.iterator({ gte: String(2).padStart(16, '0') });
    let bytesFreed = 0;
    const currentTotal = this.mapSocBytes.get(origin) || 0;

    for await (const [key, value] of iterator) {
      if (currentTotal - bytesFreed <= LIMIT_SOC_BYTES_HARD * 0.9) break;

      bytesFreed += new TextEncoder().encode(JSON.stringify(value)).length;
      await db.del(key);
    }
    this.mapSocBytes.set(origin, currentTotal - bytesFreed);
  }
}
