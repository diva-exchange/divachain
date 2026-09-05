/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Validation } from '../../../src/net/validation.ts';
import { VoteStruct } from '../../../src/chain/vote.ts';
import {
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  ConsensusBlockStruct,
  SocBlockStruct,
} from '../../../src/chain/block.ts';
import { Namespace } from '../../../src/chain/namespace.ts';
import { Util } from '../../../src/chain/util.ts';
import { Economics } from '../../../src/chain/economics.ts';
import { StatusStruct } from '../../../src/net/message/status.ts';
import {
  BlockAnnouncementStruct,
  SlashingProofStruct,
  SocAnnouncementStruct,
} from '../../../src/net/message/message.ts';
import { Wallet } from '../../../src/chain/wallet.ts';
import { Config } from '../../../src/config.ts';
import {
  createDummyKeystore,
  generateValidators,
  MOCK_HASH,
  MOCK_SIG,
  MOCK_VRF,
  ZERO_HASH,
} from '../../helpers/keystore.ts';

const NS_APP_SYSTEM = 'app:system';

const VALID_PK = 'A'.repeat(43);
const VALID_POW = 'B'.repeat(48);
const VALID_PL = 'C'.repeat(100);
const VALID_PROOF_SIG = 'D'.repeat(86);

async function setupTestWallet() {
  Economics.IS_TESTNET = true;
  const tempDir = Deno.makeTempDirSync();
  const pathKeystore = path.join(tempDir, 'keystore.enc');
  const passphraseStr = 'validation_test_passphrase';

  const config = {
    path_keystore: pathKeystore,
    i2p_sam_http: '127.0.0.1:7656',
    i2p_sam_udp: '127.0.0.1:7656',
  } as Config;

  createDummyKeystore(pathKeystore, passphraseStr);

  const passphraseBuf = createHash('sha256').update(passphraseStr).digest();
  const wallet = await Wallet.make(config, passphraseBuf);

  return { tempDir, wallet };
}

Deno.test('Validation - validateVote() schema validation', () => {
  const validation = Validation.make();
  const validVote: VoteStruct = { e: 1, ha: ZERO_HASH };
  validation.validateVote(validVote);

  const invalidVote = { e: 1, ha: 'short_hash' } as VoteStruct;
  assertThrows(
    () => validation.validateVote(invalidVote),
    Error,
    'validateVote() invalid message',
  );
});

Deno.test('Validation - validateSocBlock() command and PoW rules', async () => {
  Economics.IS_TESTNET = true;
  const validation = Validation.make();
  const socKey = 'soc_test_key_' + '0'.repeat(30);

  const validSocBlock: SocBlockStruct = {
    e: 1,
    h: 2,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: NS_APP_SYSTEM, d: 'payload' }],
  };
  validSocBlock.ha = Util.hash(validSocBlock);
  await validation.validateSocBlock(validSocBlock);

  const invalidCmdBlock: SocBlockStruct = {
    ...validSocBlock,
    cs: [{
      c: 'INVALID_COMMAND' as typeof COMMAND_DATA,
      ns: NS_APP_SYSTEM,
      d: 'p',
    }],
    ha: '',
  };
  invalidCmdBlock.ha = Util.hash(invalidCmdBlock);
  await assertRejects(
    async () => await validation.validateSocBlock(invalidCmdBlock),
    Error,
    'validateSocBlock() invalid message',
  );

  const initGenesisBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: Namespace.initGenesis(), d: 'init' }],
  };
  initGenesisBlock.ha = Util.hash(initGenesisBlock);
  await validation.validateSocBlock(initGenesisBlock, socKey);

  const badNsBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: 'app:chat', d: 'data' }],
  };
  badNsBlock.ha = Util.hash(badNsBlock);
  await assertRejects(
    async () => await validation.validateSocBlock(badNsBlock, socKey),
    Error,
    'Genesis block MUST contain sys:identity Proof of Work',
  );

  const badPowBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{
      c: COMMAND_DATA,
      ns: Namespace.SYS_IDENTITY,
      d: 'invalid_nonce_123',
    }],
  };
  badPowBlock.ha = Util.hash(badPowBlock);
  await assertRejects(
    async () => await validation.validateSocBlock(badPowBlock, socKey),
    Error,
    'Invalid Identity-PoW. Tarpit condition met.',
  );

  const validPowNonce = await Util.grindIdentityPoW(
    socKey,
    Util.getIdentityPoWDifficulty(),
  );
  const validGenesisPowBlock: SocBlockStruct = {
    e: 1,
    h: 1,
    ha: '',
    p: ZERO_HASH,
    sig: '',
    cs: [{ c: COMMAND_DATA, ns: Namespace.SYS_IDENTITY, d: validPowNonce }],
  };
  validGenesisPowBlock.ha = Util.hash(validGenesisPowBlock);
  await validation.validateSocBlock(validGenesisPowBlock, socKey);
});

Deno.test('Validation - validateConsensusBlock() command and signature rules', async () => {
  const validation = Validation.make();
  const validators31 = generateValidators();
  const { tempDir, wallet } = await setupTestWallet();

  try {
    const myPk = wallet.getPublicKey();
    const receiptSig = wallet.sign('1');

    const validConsensusBlock: ConsensusBlockStruct = {
      e: 2,
      p: ZERO_HASH,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: validators31,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: myPk, r: 100_000, sig: receiptSig }],
        },
      ],
      ha: '',
    };
    validConsensusBlock.ha = Util.hash(validConsensusBlock);
    validation.validateConsensusBlock(validConsensusBlock);

    const blockWithInvalidReceipt: ConsensusBlockStruct = {
      ...validConsensusBlock,
      cs: [
        {
          c: COMMAND_VALIDATORS,
          ns: Namespace.consensusForEpoch(2),
          d: validators31,
        },
        {
          c: COMMAND_REPUTATION,
          ns: Namespace.reputationForEpoch(2),
          d: [{ pk: myPk, r: 100_000, sig: MOCK_SIG }],
        },
      ],
      ha: '',
    };
    blockWithInvalidReceipt.ha = Util.hash(blockWithInvalidReceipt);
    assertThrows(
      () => validation.validateConsensusBlock(blockWithInvalidReceipt),
      Error,
      'invalid receipt signature',
    );
  } finally {
    wallet.close();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('Validation - validateStatus() timestamp & interval bounds', () => {
  const validation = Validation.make();

  const validStatus: StatusStruct = {
    e: 1,
    t: Date.now(),
    vrf: MOCK_VRF,
    rp: MOCK_HASH,
    sig: MOCK_SIG,
  };
  validation.validateStatus(validStatus, 0);

  const staleStatus: StatusStruct = {
    ...validStatus,
    t: Date.now() - 120_000,
  };
  assertThrows(
    () => validation.validateStatus(staleStatus, 0),
    Error,
    'timestamp out of range',
  );

  assertThrows(
    () => validation.validateStatus(validStatus, Date.now() - 1000),
    Error,
    'interval between status messages too short',
  );
});

Deno.test('Validation - validateBlockAnnouncement(), SlashingProof & SocAnnouncement', () => {
  const validation = Validation.make();

  const validAnnouncement: BlockAnnouncementStruct = {
    e: 10,
    ha: ZERO_HASH,
    sig: MOCK_SIG,
  };
  validation.validateBlockAnnouncement(validAnnouncement);

  const validProof: SlashingProofStruct = {
    e: 5,
    pk: VALID_PK,
    v1: { pow: VALID_POW, pl: VALID_PL, s: VALID_PROOF_SIG },
    v2: { pow: VALID_POW, pl: VALID_PL, s: VALID_PROOF_SIG },
  };
  validation.validateSlashingProof(validProof);

  const validSocAnnounce: SocAnnouncementStruct = {
    e: 1,
    h: 5,
    ha: ZERO_HASH,
    sig: MOCK_SIG,
  };
  validation.validateSocAnnouncement(validSocAnnounce);
});
