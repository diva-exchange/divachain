/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import Ajv, { ValidateFunction } from 'ajv';

import validators from '../schema/message/validators.json' with {
  type: 'json',
};
import reputationSchema from '../schema/message/reputation.json' with {
  type: 'json',
};
import ConsensusBlockSchema from '../schema/message/consensus-block.json' with {
  type: 'json',
};

import Vote from '../schema/message/vote.json' with { type: 'json' };
import Status from '../schema/message/status.json' with { type: 'json' };
import BlockAnnouncement from '../schema/message/block-announcement.json' with {
  type: 'json',
};
import SocAnnouncement from '../schema/message/soc-announcement.json' with {
  type: 'json',
};
import slashingProofSchema from '../schema/message/slashing-proof.json' with {
  type: 'json',
};
import data from '../schema/message/data.json' with { type: 'json' };
import checkpoint from '../schema/message/checkpoint.json' with {
  type: 'json',
};
import SocBlockSchema from '../schema/message/soc-block.json' with {
  type: 'json',
};

import {
  COMMAND_CHECKPOINT,
  COMMAND_DATA,
  COMMAND_REPUTATION,
  COMMAND_VALIDATORS,
  CommandReputation,
  ConsensusBlockStruct,
  ConsensusCommand,
  SocBlockStruct,
  SocCommand,
} from '../chain/block.ts';
import { StatusStruct } from './message/status.ts';
import {
  BlockAnnouncementStruct,
  SlashingProofStruct,
  SocAnnouncementStruct,
} from './message/message.ts';
import { Util } from '../chain/util.ts';
import { DEFAULT_NETWORK_STATUS_BROADCAST_MS } from '../config.ts';
import { VoteStruct } from '../chain/vote.ts';
import { Namespace } from '../chain/namespace.ts';

export class Validation {
  private readonly Vote: ValidateFunction;
  private readonly SocBlock: ValidateFunction;
  private readonly ConsensusBlock: ValidateFunction;
  private readonly Status: ValidateFunction;
  private readonly BlockAnnouncement: ValidateFunction;
  private readonly SlashingProof: ValidateFunction;
  private readonly SocAnnouncement: ValidateFunction;

  static make(): Validation {
    return new Validation();
  }

  private constructor() {
    this.Vote = new Ajv.default({ strict: true, allErrors: true })
      .compile(Vote);

    this.SocBlock = new Ajv.default({ strict: true, allErrors: true })
      .addSchema(data)
      .addSchema(checkpoint)
      .compile(SocBlockSchema);

    this.ConsensusBlock = new Ajv.default({ strict: true, allErrors: true })
      .addSchema(validators)
      .addSchema(reputationSchema)
      .compile(ConsensusBlockSchema);

    this.Status = new Ajv.default({ strict: true, allErrors: true })
      .compile(Status);

    this.BlockAnnouncement = new Ajv.default({ strict: true, allErrors: true })
      .compile(BlockAnnouncement);

    this.SlashingProof = new Ajv.default({ strict: true, allErrors: true })
      .compile(slashingProofSchema);

    this.SocAnnouncement = new Ajv.default({ strict: true, allErrors: true })
      .compile(SocAnnouncement);
  }

  public validateVote(struct: VoteStruct): void {
    if (!this.Vote(struct)) {
      throw new Error(
        `validateVote() invalid message: ${JSON.stringify(this.Vote.errors)}`,
      );
    }
  }

  public async validateSocBlock(
    struct: SocBlockStruct,
    socKey?: string,
  ): Promise<void> {
    if (!this.SocBlock(struct)) {
      throw new Error(
        `validateSocBlock() invalid message: ${
          JSON.stringify(this.SocBlock.errors)
        }`,
      );
    }

    const isValidCommands: boolean = struct.cs.every((c: SocCommand) =>
      c.c === COMMAND_DATA || c.c === COMMAND_CHECKPOINT
    );
    if (!isValidCommands) {
      throw new Error(
        `validateSocBlock() invalid commands in block #${struct.h}`,
      );
    }

    if (struct.h === 1 && socKey) {
      const firstCmd = struct.cs[0];

      if (firstCmd.ns !== Namespace.initGenesis()) {
        if (firstCmd.ns !== Namespace.SYS_IDENTITY) {
          throw new Error(
            'validateSocBlock() Genesis block MUST contain sys:identity Proof of Work',
          );
        }

        if (firstCmd.c !== COMMAND_DATA || typeof firstCmd.d !== 'string') {
          throw new Error(
            'validateSocBlock() Invalid Identity command structure.',
          );
        }

        if (!(await Util.verifyIdentityPoW(socKey, firstCmd.d))) {
          throw new Error(
            'validateSocBlock() Invalid Identity-PoW. Tarpit condition met.',
          );
        }
      }
    }

    this.verifyBlockHash(struct);

    if (socKey) {
      const isGenInitTemplate: boolean = struct.h === 1 &&
        struct.cs.length > 0 &&
        struct.cs[0].ns === Namespace.initGenesis();
      if (
        !isGenInitTemplate &&
        !Util.verifySignature(socKey, struct.sig, struct.ha)
      ) {
        throw new Error(
          `validateSocBlock() invalid signature for SOC ${socKey} at height ${struct.h}`,
        );
      }
    }
  }

  public validateConsensusBlock(struct: ConsensusBlockStruct): void {
    if (!this.ConsensusBlock(struct)) {
      throw new Error(
        `validateConsensusBlock() invalid message: ${
          JSON.stringify(this.ConsensusBlock.errors)
        }`,
      );
    }

    const isValidCommands: boolean = struct.cs.every((c: ConsensusCommand) =>
      c.c === COMMAND_VALIDATORS || c.c === COMMAND_REPUTATION
    );
    if (!isValidCommands) {
      throw new Error(
        `validateConsensusBlock() invalid commands in epoch #${struct.e}`,
      );
    }

    this.verifyBlockHash(struct);

    const repCommand = struct.cs.find((c: ConsensusCommand) =>
      c.c === COMMAND_REPUTATION
    ) as CommandReputation | undefined;

    if (repCommand && repCommand.d) {
      for (const data of repCommand.d) {
        if (data.sig) {
          const expectedMessage: string = `${struct.e - 1}`;

          if (!Util.verifySignature(data.pk, data.sig, expectedMessage)) {
            throw new Error(
              `validateConsensusBlock() invalid receipt signature for peer ${data.pk}`,
            );
          }
        }
      }
    }
  }

  public validateStatus(struct: StatusStruct, tLast: number = 0): void {
    if (!this.Status(struct)) {
      throw new Error(
        `validateStatus() invalid message: ${
          JSON.stringify(this.Status.errors)
        }`,
      );
    }

    const refT: number = Date.now();
    const dev: number = 60 * 1000;
    if (struct.t < refT - dev || struct.t > refT + dev) {
      throw new Error(
        `validateStatus() timestamp out of range: ${refT} != ${struct.t} +/-${dev}ms`,
      );
    }

    if ((refT - tLast) < (DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.80)) {
      throw new Error(
        `validateStatus() interval between status messages too short, ${(refT -
          tLast)}ms`,
      );
    }
  }

  public validateBlockAnnouncement(struct: BlockAnnouncementStruct): void {
    if (!this.BlockAnnouncement(struct)) {
      throw new Error(
        `validateBlockAnnouncement() invalid message: ${
          JSON.stringify(this.BlockAnnouncement.errors)
        }`,
      );
    }
  }

  public validateSlashingProof(struct: SlashingProofStruct): void {
    if (!this.SlashingProof(struct)) {
      throw new Error(
        `validateSlashingProof() invalid message: ${
          JSON.stringify(this.SlashingProof.errors)
        }`,
      );
    }
  }

  public validateSocAnnouncement(struct: SocAnnouncementStruct): void {
    if (!this.SocAnnouncement(struct)) {
      throw new Error(
        `validateSocAnnouncement() invalid message: ${
          JSON.stringify(this.SocAnnouncement.errors)
        }`,
      );
    }
  }

  private verifyBlockHash(struct: SocBlockStruct | ConsensusBlockStruct): void {
    const computedHash: string = Util.hash(struct);

    if (struct.ha !== computedHash) {
      const identifier = 'h' in struct
        ? `block #${struct.h}`
        : `epoch #${struct.e}`;
      throw new Error(`invalid hash in ${identifier}`);
    }
  }
}
