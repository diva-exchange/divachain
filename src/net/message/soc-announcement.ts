/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import {
  Message,
  SocAnnouncementStruct,
  TYPE_SOC_ANNOUNCEMENT,
} from './message.ts';

export class SocAnnouncementMessage extends Message {
  constructor(struct: SocAnnouncementStruct, origin: string) {
    super(struct, TYPE_SOC_ANNOUNCEMENT, origin);
  }

  public e(): number {
    return (this.message as SocAnnouncementStruct).e;
  }

  public h(): number {
    return (this.message as SocAnnouncementStruct).h;
  }

  public ha(): string {
    return (this.message as SocAnnouncementStruct).ha;
  }

  public sig(): string {
    return (this.message as SocAnnouncementStruct).sig;
  }
}
