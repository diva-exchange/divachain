/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from './server.ts';
import { Log } from '../logger.ts';
import { ConsensusBlockStruct } from '../chain/block.ts';
import { toB32 } from '@i2p/sam';
import { Util } from '../chain/util.ts';

export class ConsensusSync {
  private readonly server: Server;
  private syncing: boolean = false;
  private readonly MAX_QUORUM_SAMPLES = 5;

  // PENALTY BOX: Maps a peer's public key to the timestamp when their ban expires
  private penaltyBox: Map<string, number> = new Map();
  private readonly PENALTY_DURATION_MS = 10 * 60 * 1000; // 10 minutes

  static make(server: Server): ConsensusSync {
    return new ConsensusSync(server);
  }

  private constructor(server: Server) {
    this.server = server;
  }

  public isSyncing(): boolean {
    return this.syncing;
  }

  /**
   * Checks if a peer is currently serving a penalty for providing malicious data.
   */
  private isPenalized(pk: string): boolean {
    const expiry = this.penaltyBox.get(pk);
    if (!expiry) return false;

    if (Date.now() > expiry) {
      this.penaltyBox.delete(pk);
      return false;
    }
    return true;
  }

  /**
   * Places a malicious peer in the penalty box, ignoring them for future syncs.
   */
  private penalize(pk: string, reason: string): void {
    Log.warn(
      `ConsensusSync: Penalizing peer ${pk} for ${
        this.PENALTY_DURATION_MS / 1000
      }s. Reason: ${reason}`,
    );
    this.penaltyBox.set(pk, Date.now() + this.PENALTY_DURATION_MS);
  }

  public async sync(
    targetEpoch?: number,
    hintPeerPk?: string,
  ): Promise<boolean> {
    if (this.isSyncing()) return false;
    this.syncing = true;

    try {
      const currentLocal = this.server.getChain().getCurrentEpoch();

      if (targetEpoch === undefined) {
        Log.info('ConsensusSync: Generic sync requested');
        const bestTarget = await this.findNetworkTarget();
        return !bestTarget || bestTarget.e <= currentLocal
          ? true
          : await this.catchUp(bestTarget.e);
      }

      if (targetEpoch <= currentLocal) return true;

      const lag = targetEpoch - currentLocal;

      // FAST-CATCHUP SWITCH: If we are behind by more than 1 epoch,
      // batch sync via ranges instead of pulling blocks one-by-one!
      if (lag > 1) {
        Log.info(`ConsensusSync: Lag is ${lag} epochs. Using batch catch-up.`);
        return await this.catchUp(targetEpoch);
      }

      // STANDARD CONCURRENT SYNC (For a single epoch lag during live gossip)
      const abortController = new AbortController();
      try {
        let eligiblePeers = this.server.getNetwork().getPeersByEpoch(
          targetEpoch,
          true,
        );

        if (!eligiblePeers.length && hintPeerPk) {
          eligiblePeers = [hintPeerPk];
        }

        // Remove penalized peers from the eligible pool
        eligiblePeers = eligiblePeers.filter((pk) => !this.isPenalized(pk));

        if (eligiblePeers.length === 0) {
          Log.warn(
            `ConsensusSync: No valid (non-penalized) peers found for epoch ${targetEpoch}`,
          );
          return false;
        }

        const targetPeers = Util.shuffleArray(eligiblePeers).slice(0, 3);
        Log.info(
          `ConsensusSync: Fetching epoch ${targetEpoch} concurrently from ${targetPeers.length} peers...`,
        );

        // Fetch promises now return an object holding both the block and the peer's public key
        const fetchPromises = targetPeers.map(async (pk) => {
          const peer = this.server.getNetwork().getPeer(pk);
          if (!peer) throw new Error('Peer offline');

          const targetHttp = `${toB32(peer.http)}.b32.i2p`;
          const url = `http://${targetHttp}/consensus/block/${targetEpoch}`;

          // No retries (0), rely on concurrent requests instead
          const r: Response = await this.server.fetchFromApi(
            url,
            0,
            abortController.signal,
          );

          // Network issues do NOT result in a penalty
          if (!r.ok) throw new Error(`ConsensusSync - HTTP Fetch failed`);

          let block: ConsensusBlockStruct;
          try {
            block = await r.json();
            // Basic structural validation - throws if malformed
            this.server.getValidation().validateConsensusBlock(block);

            // SECURITY CHECK: Verify cryptographic continuum
            const [prevLocalBlock] = await this.server.getChain()
              .getConsensusBlockByEpoch(targetEpoch - 1);
            const expectedPrevHash: string = prevLocalBlock?.ha || '';
            if (block.p !== expectedPrevHash) {
              throw new Error(
                `Chain break detected! Expected prev: ${expectedPrevHash}, got: ${block.p}`,
              );
            }
          } catch (validationErr: unknown) {
            // Malformed JSON, invalid structure, or CHAIN BREAK -> Malicious intent -> Penalty!
            this.penalize(
              pk,
              'Delivered malformed block, invalid structure, or broken chain link',
            );
            throw validationErr;
          }

          return { block, pk };
        });

        // The fastest response that passed structural validation wins
        const winningResult = await Promise.any(fetchPromises);

        // Abort the remaining sockets to free up OS resources
        abortController.abort();

        try {
          // Deep cryptographic chain validation happens here
          await this.server.getChain().addConsensusBlock(winningResult.block);
          Log.info(`ConsensusSync: Successfully synced epoch ${targetEpoch}`);
          return true;
        } catch (chainErr: unknown) {
          // Cryptographic mismatch (wrong hash chain, bad sigs) -> Malicious intent -> Penalty!
          this.penalize(
            winningResult.pk,
            'Delivered cryptographically invalid block',
          );
          throw chainErr;
        }
      } catch (e: unknown) {
        // This triggers if ALL promises fail (or are rejected/aborted)
        Log.warn(
          { err: e },
          'ConsensusSync: All concurrent sync attempts failed or delivered invalid blocks.',
        );
        return false;
      }
    } finally {
      // Always release the sync lock to ensure UDP gossip can resume
      this.syncing = false;
    }
  }

  private async findNetworkTarget(): Promise<ConsensusBlockStruct | null> {
    const me: string = this.server.getWallet().getPublicKey();
    const knownPeers = this.server.getNetwork().getArrayNetwork().filter((p) =>
      p.publicKey !== me
    );
    const bootstraps = this.server.config.bootstrap.split(',').map((s) =>
      s.trim()
    );

    const candidates = new Set<string>();

    knownPeers.forEach((p) => {
      // Don't ask penalized peers for targets
      if (!this.isPenalized(p.publicKey)) {
        candidates.add(`http://${toB32(p.http)}.b32.i2p`);
      }
    });
    bootstraps.filter((b) => b.endsWith('.i2p')).forEach((b) =>
      candidates.add(`http://${b}`)
    );

    const shuffled = Util.shuffleArray([...candidates]).slice(
      0,
      this.MAX_QUORUM_SAMPLES,
    );
    if (shuffled.length === 0) return null;

    const tally = new Map<
      string,
      { count: number; block: ConsensusBlockStruct }
    >();
    let highestEpoch = 0;

    await Promise.all(
      shuffled.map(async (url) => {
        try {
          const r: Response = await this.server.fetchFromApi(
            `${url}/consensus/latest`,
          );
          if (r.status === 200) {
            const block: ConsensusBlockStruct = await r.json();

            if (block.e > highestEpoch) {
              highestEpoch = block.e;
            }

            const existing = tally.get(block.ha);
            if (existing) {
              existing.count++;
            } else {
              tally.set(block.ha, { count: 1, block });
            }
          }
        } catch (_e) { /* ignore unreachable nodes */ }
      }),
    );

    let bestTarget: ConsensusBlockStruct | null = null;
    let maxVotes = 0;

    for (const { count, block } of tally.values()) {
      if (block.e === highestEpoch && count > maxVotes) {
        maxVotes = count;
        bestTarget = block;
      }
    }

    return bestTarget;
  }

  private async catchUp(targetEpoch: number): Promise<boolean> {
    const me = this.server.getWallet().getPublicKey();
    const peers = this.server.getNetwork().getArrayNetwork().filter((p) =>
      p.publicKey !== me
    );
    let currentLocal = this.server.getChain().getCurrentEpoch();

    if (currentLocal === 0 && this.server.config.network_genesis_hash) {
      Log.info(
        'ConsensusSync: Cold start detected. Verifying network genesis trust anchor...',
      );

      let genesisTarget = '';
      if (peers.length > 0) {
        genesisTarget = `http://${toB32(peers[0].http)}.b32.i2p`;
      } else {
        const bootstrapPeer = this.server.config.bootstrap.split(',')[0].trim();
        genesisTarget = bootstrapPeer.startsWith('http')
          ? bootstrapPeer
          : `http://${bootstrapPeer}`;
      }

      try {
        const r: Response = await this.server.fetchFromApi(
          `${genesisTarget}/consensus/block/1`,
        );
        if (r.status === 200) {
          const genesisBlock: ConsensusBlockStruct = await r.json();
          this.server.getValidation().validateConsensusBlock(genesisBlock);

          if (genesisBlock.ha === this.server.config.network_genesis_hash) {
            // Anchor verified. Inject into local state to establish the chain link.
            await this.server.getChain().addConsensusBlock(genesisBlock);
            currentLocal = 1;
            Log.info(
              'ConsensusSync: Trust Anchor verified and locked. Ready for sync.',
            );
          } else {
            Log.error(
              `CRITICAL: Eclipse Attack averted! Provided genesis hash (${genesisBlock.ha}) does not match the configured Trust Anchor (${this.server.config.network_genesis_hash})`,
            );
            return false;
          }
        }
      } catch (e: unknown) {
        Log.warn(
          { err: e },
          'ConsensusSync: Failed to fetch Trust Anchor from network.',
        );
        return false;
      }
    }

    if (peers.length === 0) {
      const bootstraps = this.server.config.bootstrap.split(',').map((s) =>
        s.trim()
      ).filter((b) => b.endsWith('.i2p'));
      if (bootstraps.length === 0) return false;

      while (currentLocal < targetEpoch) {
        const b = bootstraps[Math.floor(Math.random() * bootstraps.length)];
        const url = `http://${b}`;

        if (
          !(await this.fetchBlocksFromUrl(
            url,
            currentLocal,
            targetEpoch,
            'bootstrap',
          ))
        ) {
          return false;
        }
        currentLocal = this.server.getChain().getCurrentEpoch();
      }
      return true;
    }

    // REGULAR CATCH-UP: Only use real peers with strict B32 resolution.
    while (currentLocal < targetEpoch) {
      const validPeers = peers.filter((p) => !this.isPenalized(p.publicKey));
      if (validPeers.length === 0) return false;

      const peer = validPeers[Math.floor(Math.random() * validPeers.length)];
      // STRICT RESOLUTION: No exceptions. MUST be .b32.i2p.
      const url = `http://${toB32(peer.http)}.b32.i2p`;

      if (
        !(await this.fetchBlocksFromUrl(
          url,
          currentLocal,
          targetEpoch,
          peer.publicKey,
        ))
      ) {
        // Failed network fetch during catchUp -> No penalty, just try again next time
        return false;
      }
      currentLocal = this.server.getChain().getCurrentEpoch();
    }

    return true;
  }

  /**
   * Helper method to process the REST-compliant range fetch logic
   */
  private async fetchBlocksFromUrl(
    baseUrl: string,
    currentLocal: number,
    targetEpoch: number,
    publicKey: string,
  ): Promise<boolean> {
    const start = currentLocal + 1;
    const end = Math.min(
      targetEpoch,
      start + this.server.config.network_sync_size - 1,
    );
    const url = `${baseUrl}/consensus/range/${start}/${end}`;

    Log.trace(`ConsensusSync: Fetching blocks from ${url}`);
    const r: Response = await this.server.fetchFromApi(url);

    if (r.status !== 200) {
      Log.warn(`ConsensusSync: Failed to fetch from ${baseUrl}`);
      return false;
    }

    try {
      const arrayBlocks: Array<ConsensusBlockStruct> = await r.json();
      if (arrayBlocks.length === 0) return false;

      // SECURITY CHECK: Verify cryptographic continuum
      const [prevLocalBlock] = await this.server.getChain()
        .getConsensusBlockByEpoch(currentLocal);
      let expectedPrevHash: string = prevLocalBlock?.ha || '';
      for (const block of arrayBlocks) {
        // Stop the malicious insertion of a broken chain!
        if (block.p !== expectedPrevHash) {
          throw new Error(
            `Chain break detected! Expected prev: ${expectedPrevHash}, got: ${block.p}`,
          );
        }

        await this.server.getConsensusFactory().processConsensusBlock(
          block,
          publicKey,
          true,
        );

        expectedPrevHash = block.ha;
      }
      return true;
    } catch (e: unknown) {
      Log.warn({ err: e }, 'ConsensusSync: Failed to parse synced blocks');
      // If we are dealing with a known peer (not bootstrap), penalize for bad data
      if (publicKey !== 'bootstrap') {
        this.penalize(
          publicKey,
          'Delivered invalid or broken block range data',
        );
      }
      return false;
    }
  }
}
