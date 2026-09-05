/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertNotEquals } from '@std/assert';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Message, TYPE_STATUS } from '../../../../src/net/message/message.ts';
import { StatusStruct } from '../../../../src/net/message/status.ts';
import { Wallet } from '../../../../src/chain/wallet.ts';
import { Config } from '../../../../src/config.ts';
import {
  createDummyKeystore,
  MOCK_HASH,
  MOCK_SIG,
  MOCK_VRF,
} from '../../../helpers/keystore.ts';

Deno.test('Message - asString() generation and verifyPoW() validation', async () => {
  const tempDir = Deno.makeTempDirSync();
  const pathKeystore = path.join(tempDir, 'keystore.enc');
  const passphraseStr = 'message_test_passphrase';

  const config = {
    path_keystore: pathKeystore,
    i2p_sam_http: '127.0.0.1:7656',
    i2p_sam_udp: '127.0.0.1:7656',
  } as Config;

  createDummyKeystore(pathKeystore, passphraseStr);

  const passphraseBuf = createHash('sha256').update(passphraseStr).digest();
  const wallet = await Wallet.make(config, passphraseBuf);

  try {
    const struct: StatusStruct = {
      e: 1,
      t: Date.now(),
      vrf: MOCK_VRF,
      rp: MOCK_HASH,
      sig: MOCK_SIG,
    };

    const myPk = wallet.getPublicKey();
    const msg = new Message(struct, TYPE_STATUS, myPk);

    const serialized = await msg.asString(wallet);
    assertNotEquals(serialized, '');

    const powAndPayload = serialized.slice(86);
    const pow = powAndPayload.slice(0, 48);
    const payload = powAndPayload.slice(48);

    const isPoWValid = await Message.verifyPoW(pow, payload);
    assertEquals(isPoWValid, true);
  } finally {
    wallet.close();
    Deno.removeSync(tempDir, { recursive: true });
  }
});
