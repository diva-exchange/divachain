/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { Vote, VoteStruct } from '../../../src/chain/vote.ts';

const MOCK_HASH = 'hash_000000000000000000000000000000000000000'; // 43 chars

Deno.test('Vote - Struct Construction & Immutability', () => {
  const inputStruct: VoteStruct = {
    e: 5,
    ha: MOCK_HASH,
  };

  const vote = new Vote(inputStruct);
  const result = vote.get();

  // Verify internal properties match input
  assertEquals(result.e, 5);
  assertEquals(result.ha, MOCK_HASH);

  // Deep structural equality
  assertEquals(result, inputStruct);
});
