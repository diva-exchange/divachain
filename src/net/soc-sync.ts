/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from './server.ts';
import { Chain } from '../chain/chain.ts';
import { Network, Peer, REPLICATION_FRACTION } from './network.ts';
import { Log } from '../logger.ts';
import { SocBlockStruct } from '../chain/block.ts';
import { Namespace } from '../chain/namespace.ts';
import { toB32 } from '@i2p/sam';
import { StorageCommittee } from '../chain/committee.ts';
import {
  Message,
  SocAnnouncementStruct,
  SocSlashingProofStruct,
  TYPE_SOC_SLASHING_PROOF,
} from './message/message.ts';

export class SocSync {
  private readonly server: Server;
  private readonly chain: Chain;
  private readonly network: Network;
  private readonly me: string;

  // Set to track currently syncing peer-chains to prevent overlapping fetches
  private setIsSyncing: Set<string> = new Set();

  public static make(server: Server): SocSync {
    return new SocSync(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.chain = server.getChain();
    this.network = server.getNetwork();
    this.me = this.server.getWallet().getNodePublicKey();
  }

  /**
   * Proactively pulls missing blocks from the target peer via HTTP/REST.
   */
  private async pullMissingBlocks(
    nodeId: string,
    startHeight: number,
    targetHeight: number,
    socKey: string = nodeId,
  ): Promise<void> {
    await this.chain.addSoc(socKey);
    const [currentLocalHeight] = this.chain.getHeight(socKey);
    let currentTargetHeight: number = Math.max(
      startHeight,
      currentLocalHeight + 1,
    );

    const peerInfo: Peer | undefined = this.network.getPeer(nodeId);
    if (!peerInfo || !peerInfo.http) return;

    const dest: string = `${toB32(peerInfo.http)}.b32.i2p`;
    Log.trace(
      `Syncing SOC for ${socKey} via node ${nodeId} from height ${startHeight} to ${targetHeight}`,
    );

    while (currentTargetHeight <= targetHeight) {
      const url: string =
        `http://${dest}/blocks/${currentTargetHeight}?pk=${socKey}`;
      const r: Response = await this.server.fetchFromApi(url);

      if (!r.ok) {
        if (r.status === 404) {
          Log.trace(
            `SOC pull skipped for ${socKey} at height ${currentTargetHeight} (${nodeId}: ${r.status})`,
          );
        } else {
          Log.warn(
            `SOC pull failed for ${socKey} at height ${currentTargetHeight} (Network error: ${r.status})`,
          );
        }
        break;
      }

      const blocks: Array<SocBlockStruct> = await r.json();
      if (!blocks || blocks.length === 0) break;
      // local-only telemetry
      this.network.addHttpRx(JSON.stringify(blocks).length);

      for (const block of blocks) {
        const [localHeight] = this.chain.getHeight(socKey);

        // 1. Post-Fetch filter
        if (block.h <= localHeight) {
          Log.trace(
            `Late delivery ignored: Block #${block.h} for ${socKey} is already local.`,
          );
          currentTargetHeight = localHeight + 1;
          continue;
        }

        // 2. Chain-Break
        if (block.h !== localHeight + 1) {
          Log.warn(
            `SOC pull chain break for ${socKey}: Expected ${
              localHeight + 1
            }, got ${block.h}`,
          );
          return;
        }

        try {
          // Await Validation since verifyIdentityPoW utilizes WebCrypto BLAKE3
          await this.server.getValidation().validateSocBlock(block, socKey);
        } catch (err: unknown) {
          Log.warn(
            { err },
            `SOC pull validation failed for ${socKey} block #${block.h}. Malicious PoW or Equivocation.`,
          );
          return;
        }

        try {
          await this.chain.addSocBlock(socKey, block);
          currentTargetHeight = block.h + 1;
        } catch (err: unknown) {
          Log.error(
            { err },
            `Failed to store synced block #${block.h} for ${socKey}`,
          );
          return;
        }
      }
    }
  }

  /**
   * Proactively queries the network to discover the HTTP address of an unknown peer
   * that was observed via UDP Gossip.
   */
  private async discoverPeer(pk: string): Promise<void> {
    const knownPeers = this.network.getArrayNetwork();
    if (!knownPeers.length) return;

    // Pick a random known peer to query
    const randomHelper =
      knownPeers[Math.floor(Math.random() * knownPeers.length)];
    if (!randomHelper || !randomHelper.http) return;

    const dest = `${toB32(randomHelper.http)}.b32.i2p`;
    const url = `http://${dest}/network/`;

    try {
      const r: Response = await this.server.fetchFromApi(url);
      if (r.ok) return;

      const discovered: Array<Peer> = await r.json();
      const missingPeer = discovered.find((p) => p.publicKey === pk);

      if (missingPeer) {
        await this.network.addPeer(missingPeer);
        Log.info(
          `Auto-Discovery: Resolved missing HTTP address for peer ${pk}`,
        );
      }
    } catch (error: unknown) {
      Log.trace(`Peer discovery failed for ${pk}: ${(error as Error).message}`);
    }
  }

  /**
   * Returns true if the node is currently pulling SOC blocks from peers.
   * Used for Liveness Protection to prevent premature BFT participation.
   */
  public isSyncActive(): boolean {
    return this.setIsSyncing.size > 0;
  }

  /**
   * Evaluates incoming UDP Gossip announcements for unknown or local SOC keys.
   * If the BFT logic dictates this node is in the Storage Committee, it triggers a direct HTTP pull.
   */
  public async processSocAnnouncement(
    announcement: SocAnnouncementStruct,
    socKey: string,
    senderNodeId: string,
  ): Promise<void> {
    const currentEpoch = this.chain.getCurrentEpoch();

    // Ignore obsolete announcements
    if (announcement.e < currentEpoch - 1) return;

    // Check if we already have this specific block locally
    const [localHeight, err] = this.chain.getHeight(socKey);

    if (!err && localHeight >= announcement.h) {
      const localBlock = await this.chain.getSocBlock(announcement.h, socKey);

      // Hash-Kollision bedeutet Equivocation (Double Spend auf Storage Ebene)
      if (localBlock && localBlock.ha !== announcement.ha) {
        Log.error(
          `STORAGE SLASHER: Equivocation detected on ${socKey} at height ${announcement.h}!`,
        );

        const proof: SocSlashingProofStruct = {
          pk: socKey,
          h: announcement.h,
          v1: { pow: '', pl: localBlock.ha, s: localBlock.sig },
          v2: { pow: '', pl: announcement.ha, s: announcement.sig },
        };

        this.chain.removeSoc(socKey);

        const msg = new Message(proof, TYPE_SOC_SLASHING_PROOF, this.me);
        this.network.broadcast(await msg.asString(this.server.getWallet()));

        return;
      }
      return;
    }

    // Prevent pulling the same block concurrently
    const pullIdentifier = `${socKey}-${announcement.h}`;
    if (this.setIsSyncing.has(pullIdentifier)) return;

    // Retrieve deterministic consensus state for Committee calculation
    const [prevBlock, errC] = this.chain.getLatestConsensusBlock();
    if (errC || !prevBlock) return;

    const stateRep = await this.chain.getReputationState(
      Namespace.reputationForEpoch(currentEpoch),
    );
    let knownCitizens: string[] = [];
    if (stateRep) {
      try {
        const parsed = JSON.parse(stateRep.value);
        knownCitizens = parsed.map((item: { pk: string }) => item.pk);
      } catch (_e) { /* ignore */ }
    }

    const amICitizen = knownCitizens.includes(this.me);
    let isResponsible = false;

    if (!amICitizen) {
      isResponsible = true; // Guests mirror everything
    } else {
      const committee = StorageCommittee.calculate(
        socKey,
        knownCitizens,
        prevBlock.ha,
        REPLICATION_FRACTION,
      );
      isResponsible = committee.includes(this.me);
    }

    if (isResponsible) {
      this.setIsSyncing.add(pullIdentifier);

      // We pull strictly from the peer that gossiped this specific announcement to us
      // to maintain plausible deniability of the true origin.
      this.pullMissingBlocks(
        senderNodeId,
        localHeight + 1,
        announcement.h,
        socKey,
      )
        .catch((err) =>
          Log.trace({ err }, `Background sync aborted for ${socKey}`)
        )
        .finally(() => this.setIsSyncing.delete(pullIdentifier));
    }
  }
}
