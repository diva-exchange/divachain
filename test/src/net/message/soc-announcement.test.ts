/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { SocAnnouncementMessage } from '../../../../src/net/message/soc-announcement.ts';
import { SocAnnouncementStruct } from '../../../../src/net/message/message.ts';
import { MOCK_PK, MOCK_SIG, ZERO_HASH } from '../../../helpers/keystore.ts';

Deno.test('SocAnnouncementMessage - Getters & Struct Integrity', () => {
  const struct: SocAnnouncementStruct = {
    e: 2,
    h: 10,
    ha: ZERO_HASH,
    sig: MOCK_SIG,
  };

  const msg = new SocAnnouncementMessage(struct, MOCK_PK);

  assertEquals(msg.getOrigin(), MOCK_PK);
  assertEquals(msg.e(), 2);
  assertEquals(msg.h(), 10);
  assertEquals(msg.ha(), ZERO_HASH);
  assertEquals(msg.sig(), MOCK_SIG);
  assertEquals(msg.getMessage(), struct);
});
