/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { Economics } from '../../../src/chain/economics.ts';

Deno.test('Economics - Static Constants & Getter Modes', () => {
  assertEquals(Economics.MAX_REPUTATION, 5_000_000_000);
  assertEquals(Economics.REPUTATION_BUILD_STEP_UPTIME, 20_000);
  assertEquals(Economics.REPUTATION_DECAY_FACTOR, 0.90);

  // Testnet vs Mainnet storage yield threshold getter
  Economics.IS_TESTNET = true;
  assertEquals(
    Economics.MIN_REPUTATION_STORAGE_YIELD,
    Economics.MIN_STORAGE_YIELD_TESTNET,
  );

  Economics.IS_TESTNET = false;
  assertEquals(
    Economics.MIN_REPUTATION_STORAGE_YIELD,
    Economics.MIN_STORAGE_YIELD_MAINNET,
  );

  Economics.IS_TESTNET = true; // Reset to default testnet mode
});

Deno.test('Economics - calculateTax() Progressive Scale', () => {
  // Below or at threshold: Tax = 0
  assertEquals(Economics.calculateTax(0), 0);
  assertEquals(Economics.calculateTax(10_000_000), 0);
  assertEquals(Economics.calculateTax(Economics.TAX_FREE_THRESHOLD), 0);

  // Mid-range progressive tax calculation
  const midRep = 2_500_000_000;
  const midTax = Economics.calculateTax(midRep);
  assertEquals(midTax > Economics.TAX_BASE_AMOUNT, true);
  assertEquals(midTax < Economics.TAX_MAX_AMOUNT, true);

  // At or above maximum threshold
  assertEquals(
    Economics.calculateTax(Economics.MAX_REPUTATION),
    Economics.TAX_MAX_AMOUNT,
  );
  assertEquals(
    Economics.calculateTax(Economics.MAX_REPUTATION + 1_000_000),
    Economics.TAX_MAX_AMOUNT,
  );
});

Deno.test('Economics - calculateStorageCost() Integer Cube Root', () => {
  // Non-positive byte sizes
  assertEquals(Economics.calculateStorageCost(0), 0);
  assertEquals(Economics.calculateStorageCost(-100), 0);

  // Positive byte sizes: icbrt(bytes) * 200
  // 1 byte -> icbrt(1) = 1 -> 1 * 200 = 200
  assertEquals(Economics.calculateStorageCost(1), 200);

  // 1000 bytes -> icbrt(1000) = 10 -> 10 * 200 = 2000
  assertEquals(Economics.calculateStorageCost(1000), 2000);

  // 8000 bytes -> icbrt(8000) = 20 -> 20 * 200 = 4000
  assertEquals(Economics.calculateStorageCost(8000), 4000);

  // 7999 bytes -> icbrt(7999) = 19 -> 19 * 200 = 3800
  assertEquals(Economics.calculateStorageCost(7999), 3800);
});
