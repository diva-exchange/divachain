/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export interface VoteStruct {
  e: number;
  ha: string;
}

export class Vote {
  private readonly e: number;
  private readonly ha: string;

  constructor(struct: { e: number; ha: string }) {
    this.e = struct.e;
    this.ha = struct.ha;
  }

  get(): VoteStruct {
    return {
      e: this.e,
      ha: this.ha,
    };
  }
}
