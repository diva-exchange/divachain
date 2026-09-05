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
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  CommandReputation,
  ConsensusBlock,
  ConsensusBlockStruct,
  ConsensusCommand,
  ReputationDelta,
  ReputationEntry,
  ValidatorEntry,
} from '../chain/block.ts';
import { Namespace } from '../chain/namespace.ts';
import { Economics } from '../chain/economics.ts';
import { Vote, VoteStruct } from '../chain/vote.ts';
import { Chain } from '../chain/chain.ts';
import { Log } from '../logger.ts';
import { Network } from './network.ts';
import { VoteMessage } from './message/vote.ts';
import {
  BlockAnnouncementStruct,
  Message,
  SlashingProofStruct,
  TYPE_BLOCK_ANNOUNCEMENT,
  TYPE_SLASHING_PROOF,
} from './message/message.ts';
import { toB32 } from '@i2p/sam';
import { Util } from '../chain/util.ts';

interface VoteRecord {
  struct: VoteStruct;
  pow: string;
  pl: string;
  s: string;
}

export class ConsensusFactory {
  private readonly server: Server;
  private readonly chain: Chain;
  private readonly network: Network;
  private readonly wallet: Wallet;
  private readonly me: string;

  private bestConsensusScore: string | null = null;
  private bestConsensusBlock: ConsensusBlockStruct | null = null;
  private readonly mapVote: Map<string, VoteRecord>;
  private isProcessingQuorum: boolean = false;
  private lastTriggeredEpoch: number = 0;

  private activePullsByPeer: Map<string, string> = new Map();
  private slashedPeers: Set<string> = new Set();

  public static make(server: Server): ConsensusFactory {
    return new ConsensusFactory(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.chain = server.getChain();
    this.network = server.getNetwork();
    this.wallet = server.getWallet();

    this.me = this.wallet.getNodePublicKey();
    this.mapVote = new Map();
  }

  public shutdown(): void {
    // Cleanup
  }

  public async triggerEpochChange(epoch: number): Promise<void> {
    if (this.lastTriggeredEpoch === epoch) return;
    this.lastTriggeredEpoch = epoch;

    const [prevBlock, err] = this.chain.getLatestConsensusBlock();
    if (err || !prevBlock) return;
    if (prevBlock.e > epoch) return;

    // --- LIVENESS PROTECTION ---
    // Prevent block proposals and voting if local SOC data is still syncing.
    // This avoids accidental BFT slashing due to latency-induced missing data.
    if (this.server.getSocSync().isSyncActive()) {
      Log.warn(
        `Liveness Protection: Node is actively syncing SOC data. Skipping block production for epoch ${
          epoch + 1
        }.`,
      );
      return;
    }

    // 1. Fetch current validators and status
    let currentValidators: Array<ValidatorEntry> = [];
    const stateVal = await this.chain.getReputationState(
      Namespace.validatorsForEpoch(epoch),
    );
    if (stateVal) {
      try {
        currentValidators = JSON.parse(stateVal.value);
      } catch (_e) { /* ignore */ }
    }

    const currentReputationMap = new Map<string, number>();
    const stateRep = await this.chain.getReputationState(
      Namespace.reputationForEpoch(epoch),
    );
    if (stateRep) {
      try {
        const parsed: Array<ReputationEntry> = JSON.parse(stateRep.value);
        parsed.forEach((item) => currentReputationMap.set(item.pk, item.r));
      } catch (_e) { /* ignore */ }
    }

    const aPeers: Array<string> = this.network.getPeersByEpoch(epoch);
    const citizens = [...currentReputationMap.keys()];
    const tempReputationMap = new Map<string, number>(currentReputationMap);
    let taxPool = 0;

    const currentEpochPresence = new Map<string, string>();
    const networkStatus = this.network.getStatus();
    for (const [peerPk, statusArray] of Object.entries(networkStatus)) {
      const validStatus = statusArray.find((s) => s.e === epoch);
      if (validStatus && validStatus.sig) {
        currentEpochPresence.set(peerPk, validStatus.sig);
      }
    }

    // 3. Lazy Uptime (2-out-of-3), Demurrage Tax & BFT SLASHING
    // Extract presence from Epoch - 1
    const presenceEminus1 = new Set<string>();
    const repCmdPrev = prevBlock.cs.find((c) => c.c === COMMAND_REPUTATION) as
      | CommandReputation
      | undefined;
    if (repCmdPrev && repCmdPrev.d) {
      repCmdPrev.d.forEach((delta) => {
        if (delta.sig) presenceEminus1.add(delta.pk);
      });
    }

    // Extract presence from Epoch - 2
    const presenceEminus2 = new Set<string>();
    const [prevPrevBlock, errPrevPrev] = await this.chain
      .getConsensusBlockByEpoch(epoch - 1);

    if (!errPrevPrev && prevPrevBlock) {
      const repCmdPrevPrev = prevPrevBlock.cs.find(
        (c: ConsensusCommand) => c.c === COMMAND_REPUTATION,
      ) as CommandReputation | undefined;

      if (repCmdPrevPrev && repCmdPrevPrev.d) {
        repCmdPrevPrev.d.forEach((delta) => {
          if (delta.sig) presenceEminus2.add(delta.pk);
        });
      }
    }

    const knownPeers = new Set([
      ...this.network.getListPeer(),
      ...citizens,
      ...aPeers,
    ]);

    for (const pk of knownPeers) {
      let newRep = tempReputationMap.get(pk) ?? 0;

      // --- BFT SLASHING EXECUTION ---
      if (this.slashedPeers.has(pk)) {
        Log.warn(
          `SLASHER: Peer ${pk} slashed for Equivocation! Burning reputation to 0.`,
        );
        newRep = 0;
        this.slashedPeers.delete(pk);
      } else {
        // Normal Reputation Logic
        let presenceCount = 0;
        if (currentEpochPresence.has(pk)) presenceCount++;
        if (presenceEminus1.has(pk)) presenceCount++;
        if (presenceEminus2.has(pk)) presenceCount++;

        if (presenceCount >= 2) {
          newRep = Math.min(
            Economics.MAX_REPUTATION,
            newRep + Economics.REPUTATION_BUILD_STEP_UPTIME,
          );
        } else {
          newRep = Math.floor(newRep * Economics.REPUTATION_DECAY_FACTOR);
        }

        const tax = Economics.calculateTax(newRep);
        if (tax > 0) {
          newRep = Math.max(0, newRep - tax);
          taxPool += tax;
        }
      }

      tempReputationMap.set(pk, newRep);
    }

    // 4. Robin Hood Redistribution
    const currentValidatorPks = new Set(currentValidators.map((v) => v.pk));
    const activeValidators = [...currentValidatorPks].filter((pk) =>
      currentEpochPresence.has(pk)
    );

    if (activeValidators.length > 0) {
      const taxShare = Math.floor(taxPool / activeValidators.length);

      for (const pk of activeValidators) {
        const rep = tempReputationMap.get(pk) ?? 0;
        tempReputationMap.set(
          pk,
          Math.min(Economics.MAX_REPUTATION, rep + taxShare),
        );
      }
    }

    // 5. Finalize Delta for Block inclusion
    const nextConsolidatedReputation: Array<ReputationEntry> = [];
    const deltaReputation: Array<ReputationDelta> = [];

    const allKnownKeys = new Set([
      ...tempReputationMap.keys(),
      ...currentEpochPresence.keys(),
    ]);

    for (const pk of allKnownKeys) {
      const oldRep: number = currentReputationMap.get(pk) ?? 0;
      const newRep: number = tempReputationMap.get(pk) || oldRep;
      const sig: string = currentEpochPresence.get(pk) || '';

      const delta: ReputationDelta = { pk };
      let includeInDelta = false;

      if (sig) {
        delta.sig = sig;
        includeInDelta = true;
      }

      if (newRep !== undefined && newRep !== oldRep) {
        delta.r = newRep;
        includeInDelta = true;
      }

      if (newRep !== undefined && newRep > 0) {
        nextConsolidatedReputation.push({ pk, r: newRep });
      }

      if (includeInDelta) {
        deltaReputation.push(delta);
      }
    }

    deltaReputation.sort((a, b) => (a.pk > b.pk ? 1 : -1));
    nextConsolidatedReputation.sort((a, b) => (a.pk > b.pk ? 1 : -1));

    // 6. Select next BFT validators
    const nextValidators = this.network.getNextValidators(
      epoch,
      currentValidators,
      nextConsolidatedReputation,
    );

    // 7. Assemble consensus block commands
    const commands: Array<ConsensusCommand> = [
      {
        c: COMMAND_VALIDATORS,
        ns: Namespace.consensusForEpoch(epoch + 1),
        d: nextValidators,
      },
    ];

    if (deltaReputation.length > 0) {
      commands.push({
        c: COMMAND_REPUTATION,
        ns: Namespace.reputationForEpoch(epoch + 1),
        d: deltaReputation,
      });
    }

    // 8. Create and adopt block locally
    const structBlock: ConsensusBlockStruct = new ConsensusBlock(
      epoch + 1,
      prevBlock,
      commands,
    ).get();

    await this.processConsensusBlock(structBlock, this.me);
    await this.broadcastBlockAnnouncement(structBlock);
  }

  private async checkQuorum(): Promise<void> {
    if (
      this.isProcessingQuorum || !this.bestConsensusBlock ||
      !this.bestConsensusScore
    ) return;

    let count = 0;
    for (const record of this.mapVote.values()) {
      if (record.struct.ha === this.bestConsensusScore) count++;
    }

    const hasQuorum = await this.network.hasQuorumBFT(count);

    if (hasQuorum && !this.isProcessingQuorum && this.bestConsensusBlock) {
      this.isProcessingQuorum = true;

      const finalBlock = this.bestConsensusBlock;
      Log.info(`BFT Consensus reached for global epoch ${finalBlock.e}!`);

      this.bestConsensusScore = null;
      this.bestConsensusBlock = null;
      this.mapVote.clear();

      try {
        await this.chain.addConsensusBlock(finalBlock);
        this.server.queueConsensusWebSocketFeed(finalBlock);
      } catch (error: unknown) {
        Log.warn(`chain.addConsensusBlock failed: ${(error as Error).message}`);
      }

      await this.broadcastBlockAnnouncement(finalBlock);
      this.isProcessingQuorum = false;
    }
  }

  /**
   * Processes an incoming Slashing Proof.
   * If the proof is cryptographically sound and proves equivocation, the peer is globally blacklisted.
   */
  public async processSlashingProof(
    proof: SlashingProofStruct,
  ): Promise<boolean> {
    // STORM PREVENTION: If already slashed, drop immediately to stop infinite gossip loops
    if (this.slashedPeers.has(proof.pk)) return false;

    // REPLAY PROTECTION: Only process proofs relevant to the current forming epoch
    const currentEpoch = this.chain.getCurrentEpoch();
    if (proof.e <= currentEpoch) return false;

    try {
      // 1. Verify signatures of BOTH conflicting votes against the accused's public key
      if (
        !Util.verifySignature(proof.pk, proof.v1.s, proof.v1.pow + proof.v1.pl)
      ) return false;
      if (
        !Util.verifySignature(proof.pk, proof.v2.s, proof.v2.pow + proof.v2.pl)
      ) return false;

      // 2. Extract JSON payloads from the raw UDP string (skips the first 44 chars: 43 for origin + 1 for type)
      const json1: VoteStruct = JSON.parse(proof.v1.pl.substring(44));
      const json2: VoteStruct = JSON.parse(proof.v2.pl.substring(44));

      // 3. The crime: Same epoch, DIFFERENT hashes
      if (json1.e === proof.e && json2.e === proof.e && json1.ha !== json2.ha) {
        Log.error(
          `GLOBAL SLASHER: Cryptographic proof of Equivocation accepted for peer ${proof.pk} in epoch ${proof.e}!`,
        );
        this.slashedPeers.add(proof.pk);

        // Gossip the proof further to ensure network-wide deterministic consensus
        const msg = new Message(proof, TYPE_SLASHING_PROOF, this.me);
        this.network.broadcast(await msg.asString(this.wallet));

        return true;
      }
    } catch (e: unknown) {
      Log.warn({ err: e }, 'Failed to process Slashing Proof');
    }

    return false;
  }

  public async processVote(
    v: VoteMessage,
    rawPow: string,
    rawPl: string,
    rawS: string,
  ): Promise<boolean> {
    const origin: string = v.getOrigin();
    const targetHash: string = v.vote().ha;
    const voteEpoch: number = v.vote().e;

    // Reject votes from past epochs
    const currentEpoch = this.chain.getCurrentEpoch();
    if (voteEpoch <= currentEpoch) return false;

    // EQUIVOCATION DETECTOR (BFT Slashing)
    const existingRecord = this.mapVote.get(origin);
    if (
      existingRecord && existingRecord.struct.e === voteEpoch &&
      existingRecord.struct.ha !== targetHash
    ) {
      Log.error(
        `LOCAL SLASHER: Equivocation detected! Peer ${origin} voted for multiple hashes in epoch ${voteEpoch}. Generating Global Proof...`,
      );

      const proof: SlashingProofStruct = {
        e: voteEpoch,
        pk: origin,
        v1: {
          pow: existingRecord.pow,
          pl: existingRecord.pl,
          s: existingRecord.s,
        },
        v2: { pow: rawPow, pl: rawPl, s: rawS },
      };

      await this.processSlashingProof(proof);
      return false; // Drop the fraudulent vote
    }

    // Buffer every valid vote asynchronously with cryptographic raw data
    this.mapVote.set(origin, {
      struct: v.vote(),
      pow: rawPow,
      pl: rawPl,
      s: rawS,
    });

    // Evaluate quorum and decide whether to gossip this vote
    if (
      this.bestConsensusScore !== null && targetHash === this.bestConsensusScore
    ) {
      await this.checkQuorum();
      return true; // We accept and relay votes that match our candidate
    }

    return false; // We buffer but do NOT gossip votes for competing candidates
  }

  public async processBlockAnnouncement(
    announcement: BlockAnnouncementStruct,
    origin: string,
  ): Promise<boolean> {
    const [latestConsensus, err] = this.chain.getLatestConsensusBlock();

    if (!err && latestConsensus && announcement.e <= latestConsensus.e) {
      return false;
    }

    if (this.bestConsensusScore === announcement.ha) {
      return false;
    }

    if (this.activePullsByPeer.has(announcement.ha)) {
      Log.trace(
        `Dropping announcement from ${origin}: Block ${
          announcement.ha.substring(0, 8)
        }... already in flight.`,
      );
      return false;
    }

    Log.info(
      `Received announcement for epoch ${announcement.e} [${
        announcement.ha.substring(0, 8)
      }...]. Pulling via HTTP...`,
    );

    this.activePullsByPeer.set(announcement.ha, origin);

    const peer = this.network.getPeer(origin);
    if (!peer || !peer.http) {
      this.activePullsByPeer.delete(announcement.ha);
      return false;
    }

    const pullUrl = `http://${
      toB32(peer.http)
    }.b32.i2p/consensus/block/${announcement.e}`;

    try {
      const r: Response = await this.server.fetchFromApi(pullUrl, 1);
      if (r.status === 200) {
        const fullBlock: ConsensusBlockStruct = await r.json();

        if (fullBlock.ha === announcement.ha) {
          this.server.getValidation().validateConsensusBlock(fullBlock);
          return await this.processConsensusBlock(fullBlock, origin);
        }
      }
    } catch (e: unknown) {
      Log.trace(
        { err: e },
        `HTTP Gossip-Pull failed for block ${announcement.ha} from ${origin}`,
      );
    } finally {
      this.activePullsByPeer.delete(announcement.ha);
    }

    return false;
  }

  public async processConsensusBlock(
    structBlock: ConsensusBlockStruct,
    origin: string,
    isSync: boolean = false,
  ): Promise<boolean> {
    if (this.isProcessingQuorum) {
      Log.trace('Ignored incoming block: Consensus currently finalizing.');
      return false;
    }

    // --- LIVENESS PROTECTION ---
    // Do not participate in live voting if payload data is out of sync.
    if (!isSync && this.server.getSocSync().isSyncActive()) {
      Log.trace(
        'Ignored incoming block: Node is asynchronous (Liveness Protection active).',
      );
      return false;
    }

    if (isSync) {
      try {
        await this.chain.addConsensusBlock(structBlock);
        this.server.queueConsensusWebSocketFeed(structBlock);
      } catch (error: unknown) {
        Log.warn(
          `chain.addConsensusBlock (sync) failed: ${(error as Error).message}`,
        );
      }
      return true;
    }

    const [latestConsensus, err] = this.chain.getLatestConsensusBlock();

    if (!err && latestConsensus && structBlock.e <= latestConsensus.e) {
      return false;
    }

    if (!err && latestConsensus && structBlock.e === latestConsensus.e + 1) {
      const score = structBlock.ha;

      if (this.bestConsensusScore === null || score < this.bestConsensusScore) {
        Log.info(
          `Monotonic Update: Adopting better consensus block candidate ${
            score.substring(0, 8)
          }... computed by ${origin}`,
        );

        this.bestConsensusScore = score;
        this.bestConsensusBlock = structBlock;

        const structVote: VoteStruct = new Vote({
          e: structBlock.e,
          ha: structBlock.ha,
        }).get();

        // Own votes do not need raw signatures for self-slashing proofs
        this.mapVote.set(this.me, {
          struct: structVote,
          pow: '',
          pl: '',
          s: '',
        });
        await this.broadcastVote(structVote);

        await this.checkQuorum();

        return true;
      } else {
        Log.trace(
          `Ignored consensus candidate: Score ${
            score.substring(0, 8)
          }... is not strictly better.`,
        );
      }
    }

    return false;
  }

  public getBestConsensusBlock(): ConsensusBlockStruct | null {
    return this.bestConsensusBlock;
  }

  private async broadcastVote(structVote: VoteStruct): Promise<void> {
    const vm: VoteMessage = new VoteMessage(structVote, this.me);
    this.network.broadcast(await vm.asString(this.wallet));
  }

  private async broadcastBlockAnnouncement(
    sB: ConsensusBlockStruct,
  ): Promise<void> {
    const announcement: BlockAnnouncementStruct = {
      e: sB.e,
      ha: sB.ha,
      sig: this.wallet.signNode(sB.ha),
    };

    const msg = new Message(announcement, TYPE_BLOCK_ANNOUNCEMENT, this.me);
    this.network.broadcast(await msg.asString(this.wallet));
  }
}
