/**
 * Copyright (C) 2022-2026 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { iMessage, Message, TYPE_STATUS } from './message.ts';

export type StatusMessageStruct = {
  t: number;
  h: number;
};

interface iStatus extends iMessage {
  t(): number;
  height(): number;
  h(): number;
}

export class StatusMessage extends Message implements iStatus {
  constructor(struct: StatusMessageStruct, pkOrigin: string) {
    super(struct, TYPE_STATUS, pkOrigin);
  }

  public setT(t: number) {
    (this.message as StatusMessageStruct).t = t > 0 ? t : Date.now();
  }

  public t(): number {
    return (this.message as StatusMessageStruct).t;
  }

  /**
   * Alias for h()
   * @returns number height
   */
  public height(): number {
    return (this.message as StatusMessageStruct).h;
  }

  public h(): number {
    return (this.message as StatusMessageStruct).h;
  }
}
