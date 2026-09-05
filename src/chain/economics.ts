/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export class Economics {
  // Global flag to switch economics logic for rapid testing
  public static IS_TESTNET: boolean = false;

  // --- PROTOCOL CONSTANTS ---
  public static readonly MAX_REPUTATION = 5_000_000_000;
  public static readonly REPUTATION_BUILD_STEP_UPTIME = 20_000;
  public static readonly REPUTATION_DECAY_FACTOR = 0.90;

  public static readonly TAX_FREE_THRESHOLD = 20_000_000;
  public static readonly TAX_BASE_AMOUNT = 40;
  public static readonly TAX_MAX_AMOUNT = 60_000;
  public static readonly TAX_VARIABLE_AMOUNT_BIGINT = 59_960n; // 60,000 - 40
  public static readonly TAX_PROGRESSIVE_RANGE_BIGINT = 4_980_000_000n; // 5,000_000_000 - 20,000,000

  public static readonly MIN_STORAGE_YIELD_TESTNET =
    Economics.REPUTATION_BUILD_STEP_UPTIME;
  public static readonly MIN_STORAGE_YIELD_MAINNET = 5_000_000;

  public static readonly CUBE_ROOT_HIGH_BOUND = 2000n; // 2000^3 = 8,000,000,000
  public static readonly STORAGE_COST_MULTIPLIER_BIGINT = 200n;

  /**
   * Minimum reputation required to qualify as a paid storage neighbor.
   * Prevents Eclipse/Sybil attacks with fresh throwaway nodes.
   *
   * TESTNET: 20,000 (1 epoch of uptime)
   * MAINNET: 5,000,000 (100 epochs of uptime)
   */
  public static get MIN_REPUTATION_STORAGE_YIELD(): number {
    return Economics.IS_TESTNET
      ? Economics.MIN_STORAGE_YIELD_TESTNET
      : Economics.MIN_STORAGE_YIELD_MAINNET;
  }

  /**
   * Calculates the progressive demurrage (tax) based on the current reputation.
   * Scaled for 10 days (approx. 500 epochs).
   *
   * @param reputation Current reputation score
   * @returns The tax amount to be deducted (0 if <= Economics.TAX_FREE_THRESHOLD)
   */
  public static calculateTax(reputation: number): number {
    if (reputation <= Economics.TAX_FREE_THRESHOLD) return 0;
    if (reputation >= Economics.MAX_REPUTATION) return Economics.TAX_MAX_AMOUNT;

    const n = BigInt(Math.floor(reputation) - Economics.TAX_FREE_THRESHOLD);
    const maxN = Economics.TAX_PROGRESSIVE_RANGE_BIGINT;

    // Progressive cubic scale: (N^3 * 59960) / maxN^3
    const progressiveTax = (n * n * n * Economics.TAX_VARIABLE_AMOUNT_BIGINT) /
      (maxN * maxN * maxN);

    return Number(BigInt(Economics.TAX_BASE_AMOUNT) + progressiveTax);
  }

  /**
   * Calculates degressive storage costs based on byte size.
   * Curve: icbrt(bytes) * 200 points
   *
   * @param bytesLength Size of the payload in bytes
   * @returns The storage cost in reputation points
   */
  public static calculateStorageCost(bytesLength: number): number {
    if (bytesLength <= 0) return 0;
    const root = Economics.integerCubeRoot(BigInt(Math.floor(bytesLength)));
    return Number(root * Economics.STORAGE_COST_MULTIPLIER_BIGINT);
  }

  /**
   * Deterministic integer cube root using binary search.
   * Safe for BFT consensus across different CPU architectures.
   *
   * @param n The number to process
   * @returns The floored cube root
   */
  private static integerCubeRoot(n: bigint): bigint {
    let low = 0n;
    let high = Economics.CUBE_ROOT_HIGH_BOUND; // Sufficient for our block sizes

    while (low <= high) {
      const mid = (low + high) / 2n;
      const mid3 = mid * mid * mid;

      if (mid3 === n) return mid;
      if (mid3 < n) low = mid + 1n;
      else high = mid - 1n;
    }
    return high;
  }
}
