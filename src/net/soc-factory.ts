/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from './server.ts';
import { Wallet } from '../chain/wallet.ts';
import {
  COMMAND_DATA,
  CommandData,
  SocBlock,
  SocBlockStruct,
  SocCommand,
} from '../chain/block.ts';
import { Chain } from '../chain/chain.ts';
import { Validation } from './validation.ts';
import { Log } from '../logger.ts';
import { Economics } from '../chain/economics.ts';
import { randomBytes } from 'node:crypto';
import { encodeBase64Url } from '@std/encoding';
import { SocAnnouncementMessage } from '../net/message/soc-announcement.ts';
import { Namespace } from '../chain/namespace.ts';
import { Util } from '../chain/util.ts';

export class SocFactory {
  private readonly server: Server;
  private readonly chain: Chain;
  private readonly validation: Validation;
  private readonly wallet: Wallet;

  private intervalDecoy: ReturnType<typeof setInterval> | null = null;
  private readonly DECOY_INTERVAL_MIN = 1000 * 60 * 15; // 15 Min
  private readonly DECOY_INTERVAL_MAX = 1000 * 60 * 60; // 60 Min
  private readonly DECOY_SIZE_MIN = 16;
  private readonly DECOY_SIZE_MAX = 4096;

  private readonly mapCreationQueue: Map<
    string,
    Promise<SocBlockStruct | null>
  > = new Map();

  public static make(server: Server): SocFactory {
    return new SocFactory(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.chain = server.getChain();
    this.validation = server.getValidation();
    this.wallet = server.getWallet();
  }

  public startDecoyLoop(): void {
    if (this.intervalDecoy) return;
    this.scheduleNextDecoy();
  }

  public shutdown(): void {
    if (this.intervalDecoy) {
      clearTimeout(this.intervalDecoy);
    }
  }

  private scheduleNextDecoy(): void {
    const nextTick = Math.floor(
      Math.random() * (this.DECOY_INTERVAL_MAX - this.DECOY_INTERVAL_MIN + 1) +
        this.DECOY_INTERVAL_MIN,
    );

    this.intervalDecoy = setTimeout(() => {
      this.generateDecoyBlock().finally(() => this.scheduleNextDecoy());
    }, nextTick);
  }

  private async generateDecoyBlock(): Promise<void> {
    if (this.server.getConsensusSync().isSyncing()) return;

    const allSocs = this.wallet.getAllSocs();
    if (allSocs.length <= 1) return;

    const decoyIndex = Math.floor(Math.random() * (allSocs.length - 1)) + 1;
    const decoyPk = allSocs[decoyIndex].publicKey;

    const nodePk = this.wallet.getNodePublicKey();
    const repData = await this.chain.getLatestReputation(nodePk);
    const reputation = typeof repData === 'number' ? repData : 0;

    if (reputation < Economics.REPUTATION_BUILD_STEP_UPTIME) return;

    const [prevBlock, err] = this.chain.getLatestSocBlock(decoyPk);

    if (err || !prevBlock) {
      Log.trace(`Initializing Decoy SOC: ${decoyPk}`);
      const nonce = await Util.grindIdentityPoW(decoyPk);

      const genesisCommand: CommandData = {
        c: COMMAND_DATA,
        ns: Namespace.SYS_IDENTITY,
        d: nonce,
      };

      await this.createLocalBlock([genesisCommand], decoyPk);
      return;
    }

    Log.trace(`Generating decoy block for SOC: ${decoyPk}`);
    const minBytes = this.DECOY_SIZE_MIN;
    const maxBytes = this.DECOY_SIZE_MAX;
    const randomSize = Math.floor(Math.random() * (maxBytes - minBytes + 1)) +
      minBytes;
    const noise = encodeBase64Url(randomBytes(randomSize));
    const command: CommandData = {
      c: COMMAND_DATA,
      ns: Namespace.getRandomAppNamespace(),
      d: noise,
    };

    await this.createLocalBlock([command], decoyPk);
  }

  /**
   * Creates a new SocBlock for the node's local Single-Owner-Chain (SOC)
   * and stores it immediately in the local LevelDB.
   */
  public createLocalBlock(
    commands: Array<SocCommand>,
    originPk = '',
  ): Promise<SocBlockStruct | null> {
    originPk = originPk || this.wallet.getPublicKey();

    const queuedCommands = [...commands];
    const targetOrigin = originPk;

    let queue = this.mapCreationQueue.get(targetOrigin) ||
      Promise.resolve(null);

    queue = queue.then(async () => {
      // Alles ab hier MUSS die gekapselten lokalen Variablen nutzen!
      let [prevBlock, err] = this.chain.getLatestSocBlock(targetOrigin);

      if (err || !prevBlock) {
        if (
          queuedCommands.length > 0 &&
          queuedCommands[0].ns === Namespace.SYS_IDENTITY
        ) {
          await this.chain.addSoc(targetOrigin);
          const [newPrev, newErr] = this.chain.getLatestSocBlock(targetOrigin);
          if (newErr || !newPrev) {
            Log.error(
              `FATAL: Could not fetch gen:init block after addSoc for ${targetOrigin}`,
            );
            return null;
          }
          prevBlock = newPrev;
        } else {
          Log.error(
            `Rejected block for ${targetOrigin}: Chain not initialized. Missing ${Namespace.SYS_IDENTITY} PoW.`,
          );
          return null;
        }
      }

      const currentEpoch: number = this.chain.getCurrentEpoch();

      const structBlock: SocBlockStruct = new SocBlock(
        currentEpoch,
        prevBlock,
        queuedCommands,
        (hash: string) => this.wallet.sign(hash, targetOrigin),
      ).get();

      try {
        await this.validation.validateSocBlock(structBlock, targetOrigin);
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        Log.error(
          { err: error, block: structBlock },
          'Local SocBlock validation failed',
        );
        return null;
      }

      try {
        await this.chain.addSocBlock(targetOrigin, structBlock);
        this.server.queueSocWebSocketFeed(structBlock);

        const announcement = new SocAnnouncementMessage({
          e: structBlock.e,
          h: structBlock.h,
          ha: structBlock.ha,
          sig: structBlock.sig,
        }, targetOrigin);

        this.server.getNetwork().broadcast(
          await announcement.asString(this.wallet),
        );
      } catch (error: unknown) {
        Log.error(
          `Failed to store local SOC block: ${(error as Error).message}`,
        );
        throw error;
      }
      return structBlock;
    }).catch((err: unknown) => {
      Log.error(`Creation queue aborted: ${(err as Error).message}`);
      throw err; // Auch hier durchreichen!
    });

    this.mapCreationQueue.set(targetOrigin, queue);
    return queue;
  }
}
