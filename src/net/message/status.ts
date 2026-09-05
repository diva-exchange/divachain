/**
 * Copyright (C) 2022-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { iMessage, Message, TYPE_STATUS } from './message.ts';

export type StatusStruct = {
  e: number;
  t: number;
  vrf: string;
  rp: string;
  sig: string;
};

interface iStatus extends iMessage {
  e(): number;
  t(): number;
  vrf(): string;
  rp(): string;
}

export class StatusMessage extends Message implements iStatus {
  constructor(struct: StatusStruct, pkOrigin: string) {
    super(struct, TYPE_STATUS, pkOrigin);
  }

  public e(): number {
    return (this.message as StatusStruct).e;
  }

  public t(): number {
    return (this.message as StatusStruct).t;
  }

  public vrf(): string {
    return (this.message as StatusStruct).vrf;
  }

  public rp(): string {
    return (this.message as StatusStruct).rp;
  }

  public sig(): string {
    return (this.message as StatusStruct).sig;
  }
}
