/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists } from '@std/assert';
import { Api } from '../../../src/net/api.ts';
import { NAME_HEADER_TOKEN_API } from '../../../src/chain/wallet.ts';
import {
  COMMAND_DATA,
  ConsensusBlockStruct,
} from '../../../src/chain/block.ts';
import { Util } from '../../../src/chain/util.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { createTestContext } from '../../helpers/env.ts';
import { MOCK_I2P_DEST } from '../../helpers/keystore.ts';

const INVALID_PK = 'invalid_pk';

Deno.test('Api - Full Endpoint & Branch Coverage', async () => {
  const ctx = await createTestContext();
  const api = Api.make(ctx.server);
  const baseUrl = `http://127.0.0.1:${ctx.config.port}`;

  try {
    const myPk = ctx.wallet.getPublicKey();
    await ctx.chain.addSoc(myPk);

    const [genesisBlock] = ctx.chain.getLatestConsensusBlock();
    const consensusBlock: ConsensusBlockStruct = {
      e: 2,
      p: genesisBlock!.ha,
      cs: [
        {
          c: 'validators',
          ns: Namespace.consensusForEpoch(2),
          d: ctx.validators,
        },
        {
          c: 'reputation',
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: myPk, r: 100_000 }],
        },
      ],
      ha: '',
    };
    consensusBlock.ha = Util.hash(consensusBlock);
    await ctx.chain.addConsensusBlock(consensusBlock);

    const resAbout = await fetch(`${baseUrl}/about`);
    assertEquals(resAbout.status, 200);
    const jsonAbout = await resAbout.json();
    assertExists(jsonAbout.version);
    assertEquals(jsonAbout.publicKey, myPk);

    assertEquals((await fetch(`${baseUrl}/favicon.ico`)).status, 204);

    const resIntroduceValid = await fetch(
      `${baseUrl}/network/introduce?pk=${myPk}&http=${
        encodeURIComponent(MOCK_I2P_DEST)
      }&udp=${encodeURIComponent(MOCK_I2P_DEST)}`,
    );
    assertEquals(resIntroduceValid.status, 202);

    assertEquals(
      (await fetch(
        `${baseUrl}/network/introduce?pk=${INVALID_PK}&http=test&udp=test`,
      )).status,
      400,
    );

    const resChallenge = await fetch(
      `${baseUrl}/network/challenge/test_nonce_123`,
    );
    assertEquals(resChallenge.status, 200);
    assertExists((await resChallenge.json()).sig);

    assertEquals((await fetch(`${baseUrl}/blocks/1`)).status, 200);
    assertEquals(
      (await fetch(`${baseUrl}/blocks/1?pk=${INVALID_PK}`)).status,
      403,
    );
    assertEquals((await fetch(`${baseUrl}/blocks/9999`)).status, 404);

    assertEquals((await fetch(`${baseUrl}/consensus/latest`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/consensus/block/2`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/consensus/block/9999`)).status, 404);
    assertEquals((await fetch(`${baseUrl}/consensus/range/1/2`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/consensus/range/2/1`)).status, 404);

    ctx.config.is_testnet = true;
    assertEquals((await fetch(`${baseUrl}/network/status`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/network/validators`)).status, 200);
    assertEquals(
      (await fetch(`${baseUrl}/network/reputation?pk=${myPk}`)).status,
      200,
    );
    assertEquals((await fetch(`${baseUrl}/network/reputation/1`)).status, 200);

    const valNs = Namespace.validatorsForEpoch(1);
    assertEquals(
      (await fetch(`${baseUrl}/reputation/state/${valNs}`)).status,
      200,
    );
    assertEquals((await fetch(`${baseUrl}/index/search?q=test`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/genesis`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/block/latest`)).status, 200);
    assertEquals((await fetch(`${baseUrl}/block/1`)).status, 200);

    const resPutNoToken = await fetch(`${baseUrl}/local/block`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ c: COMMAND_DATA, ns: 'app:test', d: 'msg' }]),
    });
    assertEquals(resPutNoToken.status, 401);

    const resPutValid = await fetch(`${baseUrl}/local/block`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        [NAME_HEADER_TOKEN_API]: ctx.wallet.getTokenAPI(),
      },
      body: JSON.stringify([{ c: COMMAND_DATA, ns: 'app:test', d: 'msg' }]),
    });
    assertEquals(resPutValid.status, 204);

    assertEquals((await fetch(`${baseUrl}/non_existent_route`)).status, 404);
  } finally {
    await api.shutdown();
    await ctx.cleanup();
  }
});
