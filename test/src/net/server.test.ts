/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import {
  assertEquals,
  assertExists,
  assertFalse,
  assertNotEquals,
  assertStrictEquals,
} from '@std/assert';
import WebSocket, { RawData } from 'ws';
import { Server } from '../../../src/net/server.ts';
import {
  COMMAND_DATA,
  ConsensusBlockStruct,
  SocBlockStruct,
} from '../../../src/chain/block.ts';
import { Economics } from '../../../src/chain/economics.ts';
import { createTestContext } from '../../helpers/env.ts';
import { awaitWsClose, awaitWsOpen } from '../../helpers/websocket.ts';
import { mockStdinRead } from '../../helpers/stdin.ts';
import { MOCK_SIG } from '../../helpers/keystore.ts';

const ZERO_HASH = '0'.repeat(43);

Deno.test({
  name: 'Server Component - Constructor behavior (Testnet vs Mainnet)',
  fn: async () => {
    const ctxTest = await createTestContext({
      isTestnet: true,
      skipChain: true,
    });
    const ctxMain = await createTestContext({
      isTestnet: false,
      skipChain: true,
    });

    Economics.IS_TESTNET = false;
    new Server(ctxTest.config);
    assertStrictEquals(Economics.IS_TESTNET, true);

    Economics.IS_TESTNET = false;
    new Server(ctxMain.config);
    assertStrictEquals(Economics.IS_TESTNET, false);

    await ctxTest.cleanup();
    await ctxMain.cleanup();
  },
});

Deno.test({
  name: 'Server Component - init() instantiates all getters properly',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await createTestContext({ skipChain: true });
    const restoreStdin = mockStdinRead();
    const server = new Server(ctx.config);

    await server.init();

    assertExists(server.getWallet());
    assertExists(server.getChain());
    assertExists(server.getValidation());
    assertExists(server.getNetwork());
    assertExists(server.getConsensusFactory());
    assertExists(server.getSocFactory());
    assertExists(server.getSocSync());
    assertExists(server.getConsensusSync());

    await server.shutdown();
    restoreStdin();
    await ctx.cleanup();
  },
});

Deno.test({
  name: 'Server Component - WebSocket Feed lifecycle and broadcast',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await createTestContext({ skipChain: true });
    const restoreStdin = mockStdinRead();
    const server = new Server(ctx.config);
    await server.init();

    const socWsUrl = `ws://${ctx.config.ip}:${ctx.config.port_block_feed}/soc`;
    const consensusWsUrl =
      `ws://${ctx.config.ip}:${ctx.config.port_block_feed}/consensus`;
    const invalidWsUrl =
      `ws://${ctx.config.ip}:${ctx.config.port_block_feed}/unknown`;

    const wsSoc = new WebSocket(socWsUrl);
    const wsConsensus = new WebSocket(consensusWsUrl);

    wsSoc.on('error', () => {});
    wsConsensus.on('error', () => {});

    await Promise.all([awaitWsOpen(wsSoc), awaitWsOpen(wsConsensus)]);

    const wsInvalid = new WebSocket(invalidWsUrl);
    wsInvalid.on('error', () => {});
    await awaitWsClose(wsInvalid);
    assertEquals(wsInvalid.readyState, WebSocket.CLOSED);

    const pSocMsg = new Promise<string>((resolve) => {
      wsSoc.on('message', (data: RawData) => resolve(data.toString('utf-8')));
    });
    const pConsensusMsg = new Promise<string>((resolve) => {
      wsConsensus.on(
        'message',
        (data: RawData) => resolve(data.toString('utf-8')),
      );
    });

    const dummySocBlock: SocBlockStruct = {
      e: 1,
      h: 5,
      ha: 'soc-hash',
      p: ZERO_HASH,
      sig: MOCK_SIG,
      cs: [{ c: COMMAND_DATA, ns: 'sys:test', d: 'payload' }],
    };
    const dummyConsensusBlock: ConsensusBlockStruct = {
      e: 1,
      p: ZERO_HASH,
      cs: [],
      ha: 'consensus-hash',
    };

    server.queueSocWebSocketFeed(dummySocBlock);
    server.queueConsensusWebSocketFeed(dummyConsensusBlock);

    assertEquals(JSON.parse(await pSocMsg).ha, 'soc-hash');
    assertEquals(JSON.parse(await pConsensusMsg).ha, 'consensus-hash');

    wsSoc.close();
    wsConsensus.close();

    await Promise.all([awaitWsClose(wsSoc), awaitWsClose(wsConsensus)]);

    await server.shutdown();
    restoreStdin();
    await ctx.cleanup();
  },
});

Deno.test({
  name: 'Server Component - fetchFromApi routing and failure conditions',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await createTestContext({ skipChain: true });
    const restoreStdin = mockStdinRead();
    const server = new Server(ctx.config);
    await server.init();

    const rFailHttps: Response = await server.fetchFromApi(
      'https://valid.b32.i2p/path',
    );
    assertFalse(rFailHttps.ok);
    const rFailDotCom: Response = await server.fetchFromApi(
      'http://clearnet-site.com/path',
    );
    assertFalse(rFailDotCom.ok);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response('data', { status: 200 })) as unknown as typeof fetch;
      const res200 = await server.fetchFromApi('http://node1.b32.i2p/test', 0);
      assertEquals(res200.status, 200);

      let attemptCounter = 0;
      globalThis.fetch = (async () => {
        attemptCounter++;
        throw new Error('Connection Refused');
      }) as unknown as typeof fetch;

      const r: Response = await server.fetchFromApi(
        'http://node1.b32.i2p/test',
        1,
      );
      assertFalse(r.ok);
      assertEquals(attemptCounter, 2);
    } finally {
      globalThis.fetch = originalFetch;
      await server.shutdown();
      restoreStdin();
      await ctx.cleanup();
    }
  },
});
