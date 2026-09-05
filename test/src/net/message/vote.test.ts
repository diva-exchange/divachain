/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { VoteMessage } from '../../../../src/net/message/vote.ts';
import { VoteStruct } from '../../../../src/chain/vote.ts';

Deno.test('VoteMessage - Instantiation & Getters', () => {
  const struct: VoteStruct = {
    e: 5,
    ha: '0'.repeat(43),
  };
  const pkOrigin = 'A'.repeat(43);

  const voteMsg = new VoteMessage(struct, pkOrigin);

  assertEquals(voteMsg.getOrigin(), pkOrigin);
  assertEquals(voteMsg.vote(), struct);
  assertEquals(voteMsg.getMessage(), struct);
  assertEquals(voteMsg.vote().e, 5);
  assertEquals(voteMsg.vote().ha, '0'.repeat(43));
});
