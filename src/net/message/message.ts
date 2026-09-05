/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { VoteStruct } from '../../chain/vote.ts';
import { StatusStruct } from './status.ts';
import { Wallet } from '../../chain/wallet.ts';
import { Log } from '../../logger.ts';
import { crypto } from '@std/crypto/crypto';
import { concat, equals } from '@std/bytes';
import { decodeBase64Url, encodeBase64Url } from '@std/encoding';

export const TYPE_VOTE = 1;
export const TYPE_STATUS = 2;
export const TYPE_BLOCK_ANNOUNCEMENT = 3;
export const TYPE_SLASHING_PROOF = 4;
export const TYPE_SOC_ANNOUNCEMENT = 5;
export const TYPE_SOC_SLASHING_PROOF = 6;

export type BlockAnnouncementStruct = {
  e: number;
  ha: string;
  sig: string;
};

export type SocAnnouncementStruct = {
  e: number;
  h: number;
  ha: string;
  sig: string;
};

export type SlashingProofStruct = {
  e: number;
  pk: string;
  v1: { pow: string; pl: string; s: string };
  v2: { pow: string; pl: string; s: string };
};

export type SocSlashingProofStruct = {
  pk: string;
  h: number;
  v1: { pow: string; pl: string; s: string };
  v2: { pow: string; pl: string; s: string };
};

type BaseValidatedMessage = {
  o: string;
  pow: string;
  s: string;
};

export type ValidatedMessage =
  & BaseValidatedMessage
  & (
    | { t: typeof TYPE_VOTE; struct: VoteStruct }
    | { t: typeof TYPE_STATUS; struct: StatusStruct }
    | { t: typeof TYPE_BLOCK_ANNOUNCEMENT; struct: BlockAnnouncementStruct }
    | { t: typeof TYPE_SLASHING_PROOF; struct: SlashingProofStruct }
    | { t: typeof TYPE_SOC_ANNOUNCEMENT; struct: SocAnnouncementStruct }
    | { t: typeof TYPE_SOC_SLASHING_PROOF; struct: SocSlashingProofStruct }
  );

export type MessagePayload =
  | VoteStruct
  | StatusStruct
  | BlockAnnouncementStruct
  | SlashingProofStruct
  | SocAnnouncementStruct
  | SocSlashingProofStruct;

export interface iMessage {
  getOrigin(): string;
  asString(wallet: Wallet): Promise<string>;
}

export class Message {
  protected readonly type: number;
  protected readonly origin: string;
  protected readonly message: MessagePayload;

  private static readonly P2P_POW_DIFFICULTY: number = 2;
  private static textEncoder: TextEncoder = new TextEncoder();

  constructor(struct: MessagePayload, type: number, origin: string) {
    this.message = struct;
    this.type = type;
    this.origin = origin;
  }

  public getMessage(): MessagePayload {
    return this.message;
  }

  public getOrigin(): string {
    return this.origin;
  }

  public async asString(wallet: Wallet): Promise<string> {
    let pl: string = this.origin + this.type +
      JSON.stringify(this.message);
    pl = (await Message.createPoW(pl)) + pl;

    const signature = this.origin === wallet.getNodePublicKey()
      ? wallet.signNode(pl)
      : wallet.sign(pl, this.origin);

    return signature + pl;
  }

  /**
   * BLAKE3 based PoW on message, which is: public key + type + data
   * @returns string 48 byte base64url encoded nonce (4 byte) + hash (32 byte)
   */
  private static async createPoW(pl: string): Promise<string> {
    const _pl: Uint8Array<ArrayBuffer> = Message.textEncoder.encode(pl);

    // Pre-hash the payload
    const payloadHash: Uint8Array<ArrayBuffer> = new Uint8Array(
      await crypto.subtle.digest('BLAKE3', _pl),
    );

    // Pre-allocate the 36-byte buffer to avoid allocations inside the loop
    const d: Uint8Array<ArrayBuffer> = new Uint8Array(36);
    d.set(payloadHash, 0); // First 32 bytes remain static

    let hash: Uint8Array<ArrayBuffer>;
    let n: number = -1;

    // Only a 4-byte buffer for the nonce view is needed
    const nB: Uint8Array<ArrayBuffer> = new Uint8Array(4);
    const view: DataView<ArrayBuffer> = new DataView(nB.buffer);

    do {
      n++;
      view.setUint32(0, n, true);
      d.set(nB, 32); // Only overwrite the last 4 bytes in the loop

      hash = new Uint8Array(await crypto.subtle.digest('BLAKE3', d));
    } while (!Message.hasDifficultyPoW(hash));

    return encodeBase64Url(concat([nB, hash]));
  }

  private static hasDifficultyPoW(hash: Uint8Array): boolean {
    for (let i = 0; i < Message.P2P_POW_DIFFICULTY; i++) {
      if (hash[i] > 0) return false;
    }
    return true;
  }

  public static async verifyPoW(pow: string, pl: string): Promise<boolean> {
    try {
      const decoded: Uint8Array<ArrayBuffer> = decodeBase64Url(pow);
      if (decoded.length !== 36) {
        return false;
      }

      const nonce: Uint8Array<ArrayBuffer> = decoded.slice(0, 4);
      const expectedHash: Uint8Array<ArrayBuffer> = decoded.slice(4);
      if (!Message.hasDifficultyPoW(expectedHash)) {
        return false;
      }

      // pre hashing
      const payloadHash: Uint8Array<ArrayBuffer> = new Uint8Array(
        await crypto.subtle.digest('BLAKE3', this.textEncoder.encode(pl)),
      );

      // final hash avoiding concat
      const d: Uint8Array<ArrayBuffer> = new Uint8Array(36);
      d.set(payloadHash, 0);
      d.set(nonce, 32);

      const computedHash = new Uint8Array(
        await crypto.subtle.digest('BLAKE3', d),
      );

      return equals(expectedHash, computedHash);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      Log.error({ err }, 'verifyPoW failed');
    }
    return false;
  }
}
