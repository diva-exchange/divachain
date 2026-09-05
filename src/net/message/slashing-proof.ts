/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import {
  Message,
  SlashingProofStruct,
  TYPE_SLASHING_PROOF,
} from './message.ts';

export class SlashingProofMessage extends Message {
  /**
   * Wraps a SlashingProofStruct to provide utility methods and inherit
   * base message capabilities (PoW generation, signing, serialization).
   *
   * @param struct The strictly validated JSON payload representing the proof.
   * @param origin The public key of the node broadcasting this proof.
   */
  constructor(struct: SlashingProofStruct, origin: string) {
    super(struct, TYPE_SLASHING_PROOF, origin);
  }

  /**
   * Returns the strictly typed payload.
   */
  public proof(): SlashingProofStruct {
    return this.message as SlashingProofStruct;
  }

  /**
   * The epoch in which the equivocation crime occurred.
   */
  public e(): number {
    return this.proof().e;
  }

  /**
   * The public key of the malicious peer being slashed.
   */
  public pk(): string {
    return this.proof().pk;
  }

  /**
   * The first cryptographic evidence component.
   */
  public v1(): { pow: string; pl: string; s: string } {
    return this.proof().v1;
  }

  /**
   * The second cryptographic evidence component.
   */
  public v2(): { pow: string; pl: string; s: string } {
    return this.proof().v2;
  }
}
