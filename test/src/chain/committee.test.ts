/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals } from '@std/assert';
import { StorageCommittee } from '../../../src/chain/committee.ts';

const MOCK_TARGET_PK = 'target_pk_00000000000000000000000000000000'; // 43 chars
const MOCK_SEED_HASH = 'seed_hash_000000000000000000000000000000000'; // 43 chars

function generateCitizens(count: number): Array<string> {
  const citizens: Array<string> = [];
  for (let i = 0; i < count; i++) {
    const num = String(i).padStart(3, '0');
    citizens.push(`citizen_pk_${num}_` + '0'.repeat(27));
  }
  return citizens;
}

Deno.test('StorageCommittee - Returns empty array if no valid citizens exist', () => {
  // 1. Empty citizens list
  const emptyCommittee = StorageCommittee.calculate(
    MOCK_TARGET_PK,
    [],
    MOCK_SEED_HASH,
    3,
  );
  assertEquals(emptyCommittee, []);

  // 2. Citizens list containing only the target SOC owner itself
  const selfCommittee = StorageCommittee.calculate(
    MOCK_TARGET_PK,
    [MOCK_TARGET_PK],
    MOCK_SEED_HASH,
    3,
  );
  assertEquals(selfCommittee, []);
});

Deno.test('StorageCommittee - Deterministic Core and Nomad selection', () => {
  const citizens = generateCitizens(30);
  citizens.push(MOCK_TARGET_PK); // Ensure targetPk is filtered out

  const committeeRun1 = StorageCommittee.calculate(
    MOCK_TARGET_PK,
    citizens,
    MOCK_SEED_HASH,
    3,
  );

  const committeeRun2 = StorageCommittee.calculate(
    MOCK_TARGET_PK,
    citizens,
    MOCK_SEED_HASH,
    3,
  );

  // 1. Check determinism across identical runs
  assertEquals(committeeRun1, committeeRun2);

  // 2. Target public key must never be included in its own storage committee
  assertEquals(committeeRun1.includes(MOCK_TARGET_PK), false);

  // 3. Size validation:
  // total citizens = 31
  // coreSize = Math.max(1, Math.floor(31 / 3)) = 10
  // nomadSize = Math.max(1, Math.floor(10 * 0.10)) = 1
  // Total expected committee length = 11
  assertEquals(committeeRun1.length, 11);

  // 4. Ensure all members in returned committee are unique
  const uniqueMembers = new Set(committeeRun1);
  assertEquals(uniqueMembers.size, committeeRun1.length);
});

Deno.test('StorageCommittee - Small network fallback handling', () => {
  const citizen1 = 'citizen_pk_001_' + '0'.repeat(27);
  const citizens = [MOCK_TARGET_PK, citizen1];

  const committee = StorageCommittee.calculate(
    MOCK_TARGET_PK,
    citizens,
    MOCK_SEED_HASH,
    3,
  );

  // coreSize = Math.max(1, Math.floor(2 / 3)) = 1 -> citizen1 is Core keeper
  // nomadCandidates = [] -> nomadKeepers = []
  assertEquals(committee, [citizen1]);
});
