/**
 * Copyright (C) 2023-2026 diva.exchange
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

import {
  createForward,
  createRaw,
  I2pSamRaw,
  I2pSamStream,
  toB32,
} from '@i2p/sam';
import { randomInt } from 'node:crypto';
import { crypto } from '@std/crypto/crypto';
import { concat, endsWith } from '@std/bytes';
import { Util } from '../chain/util.ts';
import {
  Config,
  DEFAULT_NETWORK_STATUS_BROADCAST_MS,
  DEFAULT_NETWORK_STATUS_REPUTATION_SPAN_MS,
} from '../config.ts';
import { Log } from '../logger.ts';
import { Server } from './server.ts';
import { Bootstrap } from './bootstrap.ts';
import { Wallet } from '../chain/wallet.ts';
import { Chain } from '../chain/chain.ts';
import { Peer } from '../chain/chain.ts';
import {
  TYPE_ADD_PEER,
  TYPE_REMOVE_PEER,
  TYPE_STATUS,
  TYPE_TX,
} from './message/message.ts';
import { StatusMessage, StatusMessageStruct } from './message/status.ts';
import { AddPeerMessage, AddPeerMessageStruct } from './message/add-peer.ts';
import {
  RemovePeerMessage,
  RemovePeerMessageStruct,
} from './message/remove-peer.ts';
import { TxMessage, TxMessageStruct } from './message/tx.ts';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { decodeBase64Url, encodeBase64Url } from '@std/encoding';
import { join as joinPath } from 'node:path';

export class Network {
  private static readonly P2P_MAX_RETRY_COUNT: number = 120;
  private static readonly P2P_RETRY_INTERVAL_MS: number = 1000;
  private static readonly P2P_POW_DIFFICULTY: number = 2;

  private readonly server: Server;
  private bootstrap: Bootstrap = {} as Bootstrap;
  private readonly wallet: Wallet;
  private readonly chain: Chain;
  private readonly publicKey: string;

  private samHttpForward: I2pSamStream = {} as I2pSamStream;
  private samUdp: I2pSamRaw = {} as I2pSamRaw;

  private arrayNetwork: Array<Peer> = [];
  private arrayBroadcast: Array<string> = [];

  private arrayIn: Array<string> = [];

  private intervalP2P: number = 0;
  private intervalStatus: number = 0;

  private mapStatus: Map<string, Array<StatusMessageStruct>> = new Map();
  private mapReputation: Map<string, number> = new Map();

  static make(server: Server): Network {
    const n: Network = new Network(server);
    Log.trace('Network created');
    return n;
  }

  private constructor(server: Server) {
    this.server = server;
    this.bootstrap = Bootstrap.make(server);
    this.wallet = this.server.getWallet();
    this.chain = this.server.getChain();
    this.publicKey = this.wallet.getPublicKey();
    Log.info(`Network, public key: ${this.publicKey}`);

    (async () => await this.init())();
  }

  public shutdown(): void {
    clearInterval(this.intervalP2P);
    clearInterval(this.intervalStatus);

    try {
      this.samHttpForward.close();
    } catch (error: unknown) {
      Log.warn(`SAM HTTP close failed: ${(error as Error).toString()}`);
    }
    try {
      this.samUdp.close();
    } catch (error: unknown) {
      Log.warn(`SAM UDP close failed: ${(error as Error).toString()}`);
    }
  }

  private async init(started: boolean = false, retry: number = 0) {
    retry++;
    if (retry > Network.P2P_MAX_RETRY_COUNT) {
      throw new Error(`P2P failed on ${toB32(this.server.config.udp)}.b32.i2p`);
    }

    if (this.hasP2PNetwork()) {
      Log.info(
        `P2P ready on ${toB32(this.server.config.udp)}.b32.i2p`,
      );

      if (this.server.config.bootstrap) {
        // bootstrapping (entering the network)
        await this.bootstrap.joinNetwork(this.wallet.getPublicKey());
      }

      const pathStatus: string = joinPath(
        this.server.config.path_state,
        'status.json',
      );
      try {
        for (
          const [pk, a] of Object.entries(
            JSON.parse(Deno.readTextFileSync(pathStatus)),
          )
        ) {
          if (this.chain.hasPeer(pk)) {
            this.mapStatus.set(pk, a as Array<StatusMessageStruct>);
          }
        }
        this.calculateReputation();
      } catch (error: unknown) {
        Log.trace(`${error as Error}: ${pathStatus}`);
      }

      await this.broadcastStatus();
      return;
    }

    setTimeout(async () => {
      await this.init(true, retry);
    }, Network.P2P_RETRY_INTERVAL_MS);

    if (!started) {
      Log.info('P2P starting...');
      await this.initHttp(this.server.config);
      await this.initUdp(this.server.config);

      this.intervalP2P = setInterval(() => {
        this.updateP2PNetwork();
      }, this.server.config.network_p2p_interval_ms);
      this.intervalStatus = setInterval(async () => {
        await this.broadcastStatus();
      }, DEFAULT_NETWORK_STATUS_BROADCAST_MS);
    }
  }

  private async initHttp(_c: Config): Promise<void> {
    const [http_host, http_port] = _c.i2p_sam_http.split(':');
    const [forward_host, forward_port] = _c.i2p_sam_forward_http.split(':');
    try {
      const inboundLV: number = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      const outboundLV: number = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      this.samHttpForward = await createForward({
        session: {
          options:
            `inbound.lengthVariance=${inboundLV} outbound.lengthVariance=${outboundLV}`,
        },
        sam: {
          host: http_host,
          portTCP: Number(http_port),
          publicKey: _c.i2p_public_key_http,
          privateKey: _c.i2p_private_key_http,
        },
        forward: {
          host: forward_host,
          port: Number(forward_port),
          silent: true,
        },
      });
      this.samHttpForward
        .on('error', (error: unknown) => {
          Log.warn(`SAM HTTP OnError ${(error as Error).toString()}`);
        })
        .on('close', (): void => {
          Log.info('SAM HTTP close');
        });

      Log.info(
        `SAM HTTP ready, ${
          toB32(_c.http)
        }.b32.i2p (tunnel length variance In/Out: ${inboundLV}/${outboundLV}) to ${_c.i2p_sam_forward_http}`,
      );
    } catch (error) {
      Log.warn(`SAM HTTP error ${(error as Error).toString()}`);
      Object.keys(this.samHttpForward).length && this.samHttpForward.close();
      this.samHttpForward = {} as I2pSamStream;
      setTimeout(async (): Promise<void> => {
        await this.initHttp(_c);
      }, _c.network_timeout_ms);
    }
  }

  private async initUdp(_c: Config): Promise<void> {
    const [udp_host, udp_port] = _c.i2p_sam_udp.split(':');
    const [udp_listen_host, udp_listen_port] = _c.i2p_sam_listen_udp.split(':');
    const [udp_forward_host, udp_forward_port] = _c.i2p_sam_forward_udp.split(
      ':',
    );
    try {
      const inboundLV: number = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      const outboundLV: number = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      this.samUdp = await createRaw({
        session: {
          options:
            `inbound.lengthVariance=${inboundLV} outbound.lengthVariance=${outboundLV}`,
        },
        sam: {
          host: udp_host,
          portTCP: Number(udp_port),
          portUDP: Number(_c.i2p_sam_udp_port_udp),
          publicKey: _c.i2p_public_key_udp,
          privateKey: _c.i2p_private_key_udp,
        },
        listen: {
          address: udp_listen_host,
          port: Number(udp_listen_port),
          hostForward: udp_forward_host,
          portForward: Number(udp_forward_port),
        },
      });
      this.samUdp
        .on('data', (data: Uint8Array) => {
          this.onUdpData(data);
        })
        .on('close', () => {
          Log.info('SAM UDP close');
        })
        .on('error', (error: unknown) => {
          // FIXME recovering?
          Log.warn(`SAM UDP OnError: ${(error as Error).toString()}`);
        });
      Log.info(
        `SAM UDP ready, ${
          toB32(_c.udp)
        }.b32.i2p (tunnel length variance In/Out: ${inboundLV}/${outboundLV}) listen on ${udp_listen_host}:${
          Number(udp_listen_port)
        }`,
      );
    } catch (error: unknown) {
      Log.trace(`SAM UDP error ${(error as Error).toString()}`);
      Object.keys(this.samUdp).length && this.samUdp.close();
      this.samUdp = {} as I2pSamRaw;
      setTimeout(async (): Promise<void> => {
        await this.initUdp(_c);
      }, _c.network_timeout_ms);
    }
  }

  private onUdpData(data: Uint8Array) {
    try {
      this.handleIncoming(
        new TextDecoder().decode(brotliDecompressSync(data)),
      );
    } catch (error) {
      Log.trace(
        `${this.server.config.port}: UDP, Invalid message compression format, Error: ${error}`,
      );
      return;
    }
  }

  private handleIncoming(m: string) {
    // message validity against message specs
    const re: RegExpMatchArray | false = this.isMsgValid(m);
    if (!re) {
      // TODO this is a serious breach - what is the action?
      Log.warn(
        `${this.server.config.port}: handleIncoming(), invalid message structure`,
      );
      Log.trace(`${m}`);
      return;
    }

    // 48 bytes, PoW stamp
    const powMsg: string = re[1];
    // this is only an efficiency feature, not a security feature
    if (this.arrayIn.includes(powMsg)) {
      Log.trace(`PoW already used ${powMsg}`);
      return;
    }

    const pkOrigin: string = re[3];
    const type: number = Number(re[5]);
    const struct:
      | TxMessageStruct
      | StatusMessageStruct
      | AddPeerMessageStruct
      | RemovePeerMessageStruct = JSON.parse(re[6]);

    try {
      switch (type) {
        case TYPE_TX:
          this.server.getValidation().validateTx(struct as TxMessageStruct);
          break;
        case TYPE_STATUS:
          this.server.getValidation().validateStatus(
            struct as StatusMessageStruct,
          );
          break;
        case TYPE_ADD_PEER:
          this.server.getValidation().validateAddPeer(
            struct as AddPeerMessageStruct,
          );
          break;
        case TYPE_REMOVE_PEER:
          this.server.getValidation().validateRemovePeer(
            struct as RemovePeerMessageStruct,
          );
          break;
      }
    } catch (error) {
      Log.trace(
        `${this.server.config.port}: Message validation failed, ${error}`,
      );
      // TODO this is a serious breach - what is the action?
      return;
    }

    (async (): Promise<void> => {
      try {
        switch (type) {
          case TYPE_TX:
            await this.server.getTxFactory().processTx(
              new TxMessage(struct as TxMessageStruct, pkOrigin),
            );
            break;
          case TYPE_STATUS:
            this.processStatus(
              new StatusMessage(struct as StatusMessageStruct, pkOrigin),
            );
            break;
          case TYPE_ADD_PEER:
            // this.processAddPeer(
            //   new AddPeerMessage(
            //     struct as AddPeerMessageStruct,
            //     pkOrigin,
            //   ),
            // );
            break;
          case TYPE_REMOVE_PEER:
            // this.processRemovePeer(
            //   new RemovePeerMessage(
            //     struct as RemovePeerMessageStruct,
            //     pkOrigin,
            //   ),
            // );
            break;
        }
      } catch (error) {
        Log.trace(
          `${this.server.config.port}: Message processing failed, ${error}`,
        );
        // TODO this is a serious breach - what is the action?
        return;
      }
    })();

    // efficiency
    if (this.arrayIn.push(powMsg) > this.arrayBroadcast.length * 100) {
      this.arrayIn = this.arrayIn.slice(this.arrayBroadcast.length * -10);
    }
  }

  private hasP2PNetwork(): boolean {
    return (
      this.arrayNetwork.length ===
        [...this.chain.getMapPeer().values()].length &&
      Object.keys(this.samHttpForward).length > 0 &&
      Object.keys(this.samUdp).length > 0
    );
  }

  // update network
  private updateP2PNetwork() {
    const aNetwork: Array<Peer> = [
      ...this.chain.getMapPeer().values(),
    ];

    const height: number | undefined = this.chain.getHeight(
      this.publicKey,
    );
    if (
      !height ||
      !Object.keys(this.samHttpForward).length ||
      !Object.keys(this.samUdp).length
    ) {
      return;
    }
    this.arrayNetwork = aNetwork.sort((
      p1: Peer,
      p2: Peer,
    ): number => (p1.publicKey > p2.publicKey ? 1 : -1));
    this.arrayBroadcast = this.arrayNetwork
      .map((p: Peer) => p.publicKey)
      .filter((pk: string): boolean => pk !== this.publicKey);
  }

  private async broadcastStatus() {
    const sm: StatusMessage = new StatusMessage(
      {
        t: Date.now(),
        h: this.chain.getHeight(this.publicKey),
      },
      this.publicKey,
    );
    await this.broadcast(sm.asString(this.wallet));
  }

  public async broadcast(msg: string, to?: string) {
    // single node
    if (this.arrayBroadcast.length < 2) {
      return;
    }

    // intended recipient not available within the network
    if (to && !this.arrayBroadcast.includes(to)) {
      Log.warn(`${this.server.config.port}: broadcast(), invalid recipient`);
      return;
    }

    // add PoW stamp
    msg = await this.createPoW(msg) + msg;

    // compress message
    const msgUdp: Uint8Array = brotliCompressSync(msg);

    // distribute the message to the network, via UDP
    Util.shuffleArray(
      this.arrayBroadcast.filter((pk: string): boolean =>
        this.publicKey !== pk && (!to || to === pk)
      ),
    ).forEach((pk) => {
      const udp: string = this.chain.getPeer(pk).udp;
      udp && this.samUdp.send(udp, msgUdp);
    });
  }

  public getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  public getArrayBroadcast(): Array<string> {
    return this.arrayBroadcast;
  }

  /**
   * Returns an RegExpMatchArray of the message and its parts:
   * [0] complete message
   * [1] 48 bytes, base64url, Proof-of-Work stamp
   * [2] complete payload: [3], [4], [5] and [6]
   * [3] 43 bytes, base64url, origin (public key)
   * [4] 86 bytes, base64url, signature
   * [5] 1 byte, string representation of integer, 1 - 9, see message.ts
   * [6] max 16 KiB, JSON string, message
   *
   * @param m string
   * @returns RegExpMatchArray | false
   */
  private isMsgValid(m: string): RegExpMatchArray | false {
    // Minimum length: envelope + 1 byte message
    // bytes: 5 + 43 + 43 + 86 + 1 + 1 = 179
    if (m.length < 179) {
      return false;
    }

    const re: RegExpMatchArray | null = m.match(
      /^([A-Za-z0-9_-]{48})(([A-Za-z0-9_-]{43})([A-Za-z0-9_-]{86})([1-9])(.{1,16000}))/,
    );

    // invalid format
    if (re?.length !== 7) {
      return false;
    }

    // is the message coming from a network peer?
    if (!this.chain.hasPeer(re[3])) {
      return false;
    }

    // is the message properly signed?
    if (!Util.verifySignature(re[3], re[4], [re[5], re[6]].join(''))) {
      return false;
    }

    // invalid PoW
    if (!this.verifyPoW(re[1], re[2])) {
      return false;
    }
    try {
      // message parsing
      JSON.parse(re[6]);
    } catch (_error: unknown) {
      return false;
    }

    return re;
  }

  private async createPoW(pl: string): Promise<string> {
    const _pl: Uint8Array = new TextEncoder().encode(pl);
    let hash: Uint8Array;
    let n: number = -1;
    let nB: Uint8Array;
    do {
      n++;
      nB = new Uint8Array(new Uint32Array([n]).buffer);
      const d: BufferSource = concat([_pl, nB]);
      hash = new Uint8Array(await crypto.subtle.digest('BLAKE3', d));
    } while (!this.hasDifficultyPoW(hash));
    return encodeBase64Url(concat([nB, hash]));
  }

  private hasDifficultyPoW(hash: Uint8Array): boolean {
    for (let i = 0; i < Network.P2P_POW_DIFFICULTY; i++) {
      if (hash[i] > 0) return false;
    }
    return true;
  }

  private async verifyPoW(pow: string, pl: string): Promise<boolean> {
    try {
      const hash: Uint8Array = decodeBase64Url(pow);
      // check required difficulty level
      if (this.hasDifficultyPoW(hash.slice(4))) {
        // compare hash
        const _pl: Uint8Array = new TextEncoder().encode(pl);
        const d: BufferSource = concat([_pl, hash.slice(0, 4)]);
        return endsWith(
          hash,
          new Uint8Array(await crypto.subtle.digest('BLAKE3', d)),
        );
      }
    } catch (error: unknown) {
      Log.error(`verifyPoW failed: ${(error as Error).toString()}`);
    }
    return false;
  }

  private processStatus(status: StatusMessage) {
    const origin: string = status.getOrigin();
    const aT: Array<StatusMessageStruct> = this.mapStatus.get(origin) ||
      [];
    const tNow: number = Date.now();
    const tLast: number = aT.length > 0 ? aT[aT.length - 1].t : 0;
    if ((tNow - tLast) < (DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.95)) {
      // not interested
      Log.warn('processStatus: status message received too often');
      return;
    }
    status.setT(tNow);
    aT.push(status.getMessage() as StatusMessageStruct);
    this.mapStatus.set(origin, aT);
    this.storeStatus();
  }

  private async storeStatus() {
    const pathStatus: string = joinPath(
      this.server.config.path_state,
      'status.json',
    );
    await Deno.writeTextFile(
      pathStatus,
      JSON.stringify(this.getStatus()),
      { mode: 0o644 },
    );

    this.calculateReputation();
  }

  private calculateReputation() {
    // reputation
    const tNow: number = Date.now();
    const tSpan: number = DEFAULT_NETWORK_STATUS_REPUTATION_SPAN_MS;
    const tDiff: number = tNow - tSpan;
    this.mapStatus.forEach((aT, origin) => {
      while (aT.length && aT[0].t < tDiff) {
        aT.shift();
      }
      const r = aT.length / (tSpan / DEFAULT_NETWORK_STATUS_BROADCAST_MS);
      this.mapReputation.set(origin, r);
    });
  }

  public getStatus(): { [k: string]: Array<StatusMessageStruct> } {
    return Object.fromEntries(this.mapStatus.entries());
  }

  public getReputation(): { [k: string]: number } {
    return Object.fromEntries(this.mapReputation.entries());
  }
}
