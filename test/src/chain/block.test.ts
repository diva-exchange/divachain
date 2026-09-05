/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlock,
  ConsensusBlockStruct,
  SocBlock,
  SocBlockStruct,
} from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { MOCK_PK, MOCK_VRF, ZERO_HASH } from '../../helpers/keystore.ts';

Deno.test('Block - SocBlock Creation & Chain Linking', () => {
  const prevSocBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: 'app:system', d: MOCK_PK }],
  };
  prevSocBlock.ha = Util.hash(prevSocBlock);

  const commands = [{ c: COMMAND_DATA, ns: 'app:chat', d: 'Hello World' }];
  const newSocBlockInstance = new SocBlock(1, prevSocBlock, commands, () => '');
  const newSocBlock = newSocBlockInstance.get();

  assertEquals(newSocBlock.h, 2);
  assertEquals(newSocBlock.e, 1);
  assertEquals(newSocBlock.p, prevSocBlock.ha);

  assertEquals(typeof newSocBlock.ha, 'string');
  assertEquals(newSocBlock.ha.length, 43);
  assertMatch(newSocBlock.ha, /^[A-Za-z0-9_-]{43}$/);
  assertNotEquals(newSocBlock.ha, prevSocBlock.ha);

  assertEquals(newSocBlock.cs, commands);
});

Deno.test('Block - ConsensusBlock Creation & Multi-Command Structuring', () => {
  const prevConsensusBlock: ConsensusBlockStruct = {
    e: 1,
    p: ZERO_HASH,
    cs: [
      {
        c: COMMAND_REPUTATION,
        ns: Namespace.reputationForEpoch(1),
        d: [{ pk: MOCK_PK, r: 100_000 }],
      },
    ],
    ha: '',
  };
  prevConsensusBlock.ha = Util.hash(prevConsensusBlock);

  const validators = Array.from({ length: 31 }, () => ({
    pk: MOCK_PK,
    vrf: MOCK_VRF,
  }));

  const consensusCommands = [
    {
      c: COMMAND_VALIDATORS,
      ns: Namespace.consensusForEpoch(2),
      d: validators,
    },
    {
      c: COMMAND_REPUTATION,
      ns: Namespace.reputationForEpoch(2),
      d: [{ pk: MOCK_PK, r: 150_000 }],
    },
  ];

  const newConsensusBlockInstance = new ConsensusBlock(
    2,
    prevConsensusBlock,
    consensusCommands,
  );
  const newConsensusBlock = newConsensusBlockInstance.get();

  assertEquals(newConsensusBlock.e, 2);
  assertEquals(newConsensusBlock.p, prevConsensusBlock.ha);
  assertMatch(newConsensusBlock.ha, /^[A-Za-z0-9_-]{43}$/);

  assertEquals(newConsensusBlock.cs.length, 2);
  assertEquals(newConsensusBlock.cs[0].c, COMMAND_VALIDATORS);
  assertEquals(newConsensusBlock.cs[1].c, COMMAND_REPUTATION);
});
