/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Util } from './util.ts';

export class StorageCommittee {
  /**
   * Deterministically calculates the responsible nodes (Core + Nomads) for a SOC.
   *
   * @param targetPk The public key of the SOC owner.
   * @param citizens The list of all established citizens (reputation > 0).
   * @param seedHash The hash of the previous consensus block (used as lottery seed).
   * @param replicationFraction The fraction divisor (e.g., 3) to determine core size.
   * @returns Array of public keys assigned to store the data.
   */
  public static calculate(
    targetPk: string,
    citizens: Array<string>,
    seedHash: string,
    replicationFraction: number,
  ): Array<string> {
    const validCitizens = citizens.filter((pk) => pk !== targetPk);
    if (validCitizens.length === 0) return [];

    // 1. Core Committee (XOR-based)
    // Note: The base size relies on the original citizens array length
    // to accurately reflect the network scale.
    const coreSize = Math.max(
      1,
      Math.floor(citizens.length / replicationFraction),
    );

    const sortedByXor = validCitizens
      .map((pk) => ({ pk, distance: Util.xorDistance(targetPk, pk) }))
      .sort((a, b) => (a.distance < b.distance ? -1 : 1));

    const coreKeepers = new Set(
      sortedByXor.slice(0, coreSize).map((n) => n.pk),
    );

    // 2. Nomad Committee (Hash Lottery)
    // Allocate 10% of the core size to randomly selected nomads
    const nomadSize = Math.max(1, Math.floor(coreSize * 0.10));
    const nomadCandidates = validCitizens.filter((pk) => !coreKeepers.has(pk));

    const sortedByLottery = nomadCandidates
      .map((pk) => ({ pk, hash: Util.hashString(seedHash + pk) }))
      .sort((a, b) => (a.hash < b.hash ? -1 : 1));

    const nomadKeepers = new Set(
      sortedByLottery.slice(0, nomadSize).map((n) => n.pk),
    );

    // 3. Merge and return
    return [...coreKeepers, ...nomadKeepers];
  }
}
