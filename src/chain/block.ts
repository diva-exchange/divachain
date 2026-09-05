/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Util } from './util.ts';

export const COMMAND_VALIDATORS = 'validators' as const;
export type ValidatorEntry = {
  pk: string;
  vrf: string;
};
export type CommandValidators = {
  c: typeof COMMAND_VALIDATORS;
  ns: string;
  d: Array<ValidatorEntry>;
};

export const COMMAND_REPUTATION = 'reputation' as const;
export interface ReputationDelta {
  pk: string;
  sig?: string;
  r?: number;
}

export interface CommandReputation {
  c: typeof COMMAND_REPUTATION;
  ns: string;
  d: Array<ReputationDelta>;
}

export type ReputationEntry = {
  pk: string;
  r: number;
};

export type ConsensusCommand = CommandValidators | CommandReputation;
export type ConsensusBlockStruct = {
  e: number;
  ha: string;
  p: string;
  cs: Array<ConsensusCommand>;
};

export const COMMAND_DATA = 'data' as const;
export type CommandData = {
  c: typeof COMMAND_DATA;
  ns: string;
  d: string;
};

export const COMMAND_CHECKPOINT = 'checkpoint' as const;
export type CommandCheckpoint = {
  c: typeof COMMAND_CHECKPOINT;
  ns: string;
  d: { ah: string; b: number };
};

export type SocCommand = CommandData | CommandCheckpoint;
export type SocBlockStruct = {
  e: number;
  h: number;
  ha: string;
  p: string;
  sig: string;
  cs: Array<SocCommand>;
};

export class SocBlock {
  private readonly struct: SocBlockStruct;

  constructor(
    epoch: number,
    prevBlock: SocBlockStruct,
    cs: Array<SocCommand>,
    signer: (hash: string) => string,
  ) {
    const h = prevBlock.h + 1;
    const structForHash: SocBlockStruct = {
      e: epoch,
      h,
      ha: '',
      p: prevBlock.ha,
      sig: '',
      cs,
    };

    const hash = Util.hash(structForHash);
    this.struct = {
      ...structForHash,
      ha: hash,
      sig: signer(hash),
    };
  }

  public get(): SocBlockStruct {
    return this.struct;
  }
}

export class ConsensusBlock {
  private readonly struct: ConsensusBlockStruct;

  constructor(
    epoch: number,
    prevBlock: ConsensusBlockStruct,
    cs: Array<ConsensusCommand>,
  ) {
    const structForHash: ConsensusBlockStruct = {
      e: epoch,
      ha: '',
      p: prevBlock.ha,
      cs,
    };

    this.struct = {
      ...structForHash,
      ha: Util.hash(structForHash),
    };
  }

  public get(): ConsensusBlockStruct {
    return this.struct;
  }
}
