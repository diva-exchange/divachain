/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { iMessage, Message, TYPE_VOTE } from './message.ts';
import { VoteStruct } from '../../chain/vote.ts';

interface iVoteMessage extends iMessage {
  vote(): VoteStruct;
}

export class VoteMessage extends Message implements iVoteMessage {
  constructor(struct: VoteStruct, pkOrigin: string) {
    super(struct, TYPE_VOTE, pkOrigin);
  }

  vote(): VoteStruct {
    return this.message as VoteStruct;
  }
}
