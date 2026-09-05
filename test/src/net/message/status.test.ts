/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import {
  StatusMessage,
  StatusStruct,
} from '../../../../src/net/message/status.ts';
import {
  MOCK_HASH,
  MOCK_PK,
  MOCK_SIG,
  MOCK_VRF,
} from '../../../helpers/keystore.ts';

Deno.test('StatusMessage - Getters & Struct Integrity', () => {
  const struct: StatusStruct = {
    e: 5,
    t: 1700000000000,
    vrf: MOCK_VRF,
    rp: MOCK_HASH,
    sig: MOCK_SIG,
  };

  const statusMsg = new StatusMessage(struct, MOCK_PK);

  assertEquals(statusMsg.getOrigin(), MOCK_PK);
  assertEquals(statusMsg.e(), 5);
  assertEquals(statusMsg.t(), 1700000000000);
  assertEquals(statusMsg.vrf(), MOCK_VRF);
  assertEquals(statusMsg.rp(), MOCK_HASH);
  assertEquals(statusMsg.sig(), MOCK_SIG);
  assertEquals(statusMsg.getMessage(), struct);
});
