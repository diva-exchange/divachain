/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertMatch } from '@std/assert';
import { Namespace } from '../../../src/chain/namespace.ts';

// Schema Regex pattern for namespaces in commands: ^([A-Za-z0-9_-]{2,16}:){1,7}[A-Za-z0-9_-]{2,16}$
const NS_REGEX = /^([A-Za-z0-9_-]{2,16}:){1,7}[A-Za-z0-9_-]{2,16}$/;

Deno.test('Namespace - Static Constants & Methods', () => {
  // Genesis init namespace check
  assertEquals(Namespace.GENSIS_INIT, 'gen:init');
  assertEquals(Namespace.initGenesis(), 'gen:init');
  assertMatch(Namespace.initGenesis(), NS_REGEX);

  // Epoch-based namespace formatting
  assertEquals(Namespace.validatorsForEpoch(1), 'con:val:0000000000000001');
  assertEquals(Namespace.validatorsForEpoch(42), 'con:val:0000000000000042');
  assertMatch(Namespace.validatorsForEpoch(1), NS_REGEX);

  assertEquals(Namespace.reputationForEpoch(1), 'con:rep:0000000000000001');
  assertEquals(Namespace.reputationForEpoch(100), 'con:rep:0000000000000100');
  assertMatch(Namespace.reputationForEpoch(1), NS_REGEX);

  assertEquals(Namespace.consensusForEpoch(1), 'con:epc:0000000000000001');
  assertEquals(Namespace.consensusForEpoch(999), 'con:epc:0000000000000999');
  assertMatch(Namespace.consensusForEpoch(1), NS_REGEX);
});
