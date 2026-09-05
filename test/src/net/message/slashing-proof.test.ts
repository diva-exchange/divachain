/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { SlashingProofMessage } from '../../../../src/net/message/slashing-proof.ts';
import { SlashingProofStruct } from '../../../../src/net/message/message.ts';

Deno.test('SlashingProofMessage - Instantiation & Getters', () => {
  const struct: SlashingProofStruct = {
    e: 12,
    pk: 'A'.repeat(43),
    v1: {
      pow: 'B'.repeat(48),
      pl: 'C'.repeat(100),
      s: 'D'.repeat(86),
    },
    v2: {
      pow: 'E'.repeat(48),
      pl: 'F'.repeat(100),
      s: 'G'.repeat(86),
    },
  };
  const originPk = 'X'.repeat(43);

  const msg = new SlashingProofMessage(struct, originPk);

  assertEquals(msg.getOrigin(), originPk);
  assertEquals(msg.proof(), struct);
  assertEquals(msg.getMessage(), struct);
  assertEquals(msg.e(), 12);
  assertEquals(msg.pk(), 'A'.repeat(43));
  assertEquals(msg.v1(), struct.v1);
  assertEquals(msg.v2(), struct.v2);
});
