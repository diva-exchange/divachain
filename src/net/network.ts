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

import EventEmitter from 'node:events';
import {
  createForward,
  createRaw,
  I2pSamRaw,
  I2pSamStream,
  toB32,
} from '@i2p/sam';
import zlib from 'node:zlib';
import { nanoid } from 'nanoid';
import { randomInt } from 'node:crypto';
import { concat } from '@std/bytes';
import { Util } from '../chain/util.ts';
import { Config, DEFAULT_NETWORK_STATUS_BROADCAST_MS } from '../config.ts';
import { Log } from '../logger.ts';
import { Server } from './server.ts';
import { Peer } from '../chain/chain.ts';
import { TYPE_STATUS, TYPE_TX, TYPE_VOTE } from './message/message.ts';
import { VoteMessage, VoteMessageStruct } from './message/vote.ts';
import {
  StatusMatrixRecord,
  StatusMessage,
  StatusMessageStruct,
} from './message/status.ts';
import { TxMessage, TxMessageStruct } from './message/tx.ts';
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers';

export class Network extends EventEmitter {
  private static readonly P2P_MAX_RETRY_COUNT: number = 120;
  private static readonly P2P_MAX_RETRY_INTERVAL_MS: number = 1000;

  private readonly server: Server;
  private readonly publicKey: string;

  private samHttpForward: I2pSamStream = {} as I2pSamStream;
  private samUdp: I2pSamRaw = {} as I2pSamRaw;

  private arrayNetwork: Array<Peer> = [];
  private arrayBroadcast: Array<string> = [];

  private arrayIn: Array<string> = [];
  private arrayMsgUid: Array<string> = [];
  private mapMsgParts: Map<string, number> = new Map(); // uid, total parts
  private mapMsg: Map<string, Array<Uint8Array>> = new Map(); // uid, message parts
  private arrayProcessedMsgUid: Array<string> = [];

  private timeoutP2P: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutStatus: NodeJS.Timeout = {} as NodeJS.Timeout;

  static make(server: Server): Network {
    return new Network(server);
  }

  private constructor(server: Server) {
    super();

    this.server = server;

    this.publicKey = this.server.getWallet().getPublicKey();
    Log.info(`Network, public key: ${this.publicKey}`);

    if (this.server.config.bootstrap) {
      this.bootstrapNetwork();
    }

    this.init();
  }

  public shutdown(): void {
    clearTimeout(this.timeoutP2P);
    clearTimeout(this.timeoutStatus);

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

  private init(started: boolean = false, retry: number = 0): void {
    retry++;
    if (retry > Network.P2P_MAX_RETRY_COUNT) {
      throw new Error(`P2P failed on ${toB32(this.server.config.udp)}.b32.i2p`);
    }

    if (this.hasP2PNetwork()) {
      this.emit('ready');
      Log.info(
        `P2P ready on ${toB32(this.server.config.udp)}.b32.i2p`,
      );
    } else {
      setTimeout((): void => {
        this.init(true, retry);
      }, Network.P2P_MAX_RETRY_INTERVAL_MS);
    }

    if (started) {
      return;
    }

    Log.info('P2P starting...');
    this.p2pNetwork();

    (async (): Promise<void> => {
      await this.initHttp(this.server.config);
      await this.initUdp(this.server.config);
    })();
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
        .on('data', (data: Uint8Array): void => {
          this.onUdpData(data);
        })
        .on('close', (): void => {
          Log.info('SAM UDP close');
        })
        .on('error', (error: unknown): void => {
          //@FIXME recovering?
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

  private onUdpData(data: Uint8Array): void {
    try {
      const uid: string = data.subarray(2, 16).toString();

      if (this.arrayProcessedMsgUid.includes(uid)) {
        return;
      }

      const part: number = data.subarray(0, 1).toString().charCodeAt(0) - 33;
      const parts: number = data.subarray(1, 2).toString().charCodeAt(0) - 33;
      const partsMsg: number = this.mapMsgParts.get(uid) || parts;
      const msg: Uint8Array = data.subarray(16);
      //@TODO hard upper limit of 90 parts
      if (
        !msg.length || partsMsg !== parts || part < 0 || part > 90 ||
        parts < 0 || parts > 90 || part > parts
      ) {
        Log.warn(`${this.server.config.port}: UDP, invalid split message`);
        return;
      }

      const aMsg: Array<Uint8Array> = this.mapMsg.get(uid) || [];
      if (!aMsg[part]) {
        aMsg[part] = msg;
        if (aMsg.filter((b: Uint8Array): boolean => !!b).length === parts + 1) {
          this.mapMsgParts.delete(uid);
          this.mapMsg.delete(uid);
          this.arrayProcessedMsgUid.push(uid);
          this.handleIncoming(
            zlib.brotliDecompressSync(concat(aMsg)).toString(),
          );
        } else {
          this.mapMsgParts.set(uid, parts);
          this.mapMsg.set(uid, aMsg);
        }
      }
    } catch (error) {
      Log.trace(
        `${this.server.config.port}: UDP, Invalid message compression format, Error: ${error}`,
      );
      return;
    }
  }

  private handleIncoming(m: string): void {
    const re: RegExpMatchArray | false = this.isMsgValid(m);
    if (!re) {
      Log.trace(
        `${this.server.config.port}: handleIncoming(), invalid message structure`,
      );
      return;
    }

    //@TODO review message efficiency
    // first 129 bytes of a message: public key (43 bytes), signature (86 bytes)
    const uidMsg: string = m.substring(0, 129);
    // this is only an efficiency feature (not a security feature)
    if (this.arrayIn.includes(uidMsg)) {
      return;
    }

    // envelope
    const pkOrigin: string = re[1];
    const sig: string = re[2];
    const type: number = Number(re[3]);
    const message: string = re[4];

    // is the message coming from a network peer?
    if (!this.server.getChain().hasPeer(pkOrigin)) {
      return;
    }

    // is the message properly signed?
    if (!Util.verifySignature(pkOrigin, sig, [type, message].join(''))) {
      //@TODO this is a serious breach - what is the action?
      return;
    }

    let struct: TxMessageStruct | VoteMessageStruct | StatusMessageStruct;
    try {
      struct = JSON.parse(atob(message));
    } catch (error) {
      Log.trace(
        `${this.server.config.port}: Message parsing failed, ${error}`,
      );
      //@TODO this is a serious breach - what is the action?
      return;
    }

    try {
      if (type === TYPE_TX) {
        this.server.getValidation().validateTx(struct as TxMessageStruct);
      } else if (type === TYPE_VOTE) {
        this.server.getValidation().validateVote(struct as VoteMessageStruct);
      } else if (type === TYPE_STATUS) {
        this.server.getValidation().validateStatus(
          struct as StatusMessageStruct,
        );
      }
    } catch (error) {
      Log.trace(
        `${this.server.config.port}: Message validation failed, ${error}`,
      );
      //@TODO this is a serious breach - what is the action?
      return;
    }

    (async (): Promise<void> => {
      try {
        if (type === TYPE_TX) {
          await this.server.getTxFactory().processTx(
            new TxMessage(struct as TxMessageStruct, pkOrigin),
          );
        } else if (type === TYPE_VOTE) {
          await this.server.getTxFactory().processVote(
            new VoteMessage(struct as VoteMessageStruct, pkOrigin),
          );
        } else if (type === TYPE_STATUS) {
          await this.server.getTxFactory().processStatus(
            new StatusMessage(struct as StatusMessageStruct, pkOrigin),
          );
        }
      } catch (error) {
        Log.trace(
          `${this.server.config.port}: Message processing failed, ${error}`,
        );
        //@TODO this is a serious breach - what is the action?
        return;
      }
    })();

    // efficiency
    this.arrayIn.push(uidMsg) > this.arrayBroadcast.length * 100 &&
      (this.arrayIn = this.arrayIn.slice(this.arrayBroadcast.length * -10));
  }

  private hasP2PNetwork(): boolean {
    return (
      this.arrayNetwork.length ===
        [...this.server.getChain().getMapPeer().values()].length &&
      Object.keys(this.samHttpForward).length > 0 &&
      Object.keys(this.samUdp).length > 0
    );
  }

  // update network and send out status message to network
  private p2pNetwork(): void {
    const aNetwork: Array<Peer> = [
      ...this.server.getChain().getMapPeer().values(),
    ];
    this.timeoutP2P = setTimeout((): void => {
      this.p2pNetwork();
    }, this.server.config.network_p2p_interval_ms);

    const height: number | undefined = this.server.getChain().getHeight(
      this.publicKey,
    );
    if (
      !height ||
      aNetwork.length < 2 ||
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

    // status message, broadcast to the network
    clearTimeout(this.timeoutStatus);
    this.timeoutStatus = setTimeout(
      (): void => {
        const matrix: Array<StatusMatrixRecord> = this.arrayNetwork.map(
          (p: Peer): StatusMatrixRecord => {
            return {
              origin: p.publicKey,
              height: this.server.getChain().getHeight(p.publicKey) || 0,
            };
          },
        );
        const sm: StatusMessage = new StatusMessage(
          { matrix: matrix },
          this.publicKey,
        );
        this.broadcast(sm.asString(this.server.getWallet()));
      },
      DEFAULT_NETWORK_STATUS_BROADCAST_MS,
    );
  }

  public broadcast(data: string, to?: string): void {
    const re: RegExpMatchArray | false = this.isMsgValid(data);
    if (!re) {
      Log.warn(
        `${this.server.config.port}: broadcast(), invalid message structure`,
      );
      return;
    }
    if (to && !this.arrayBroadcast.includes(to)) {
      Log.warn(`${this.server.config.port}: broadcast(), invalid recipient`);
      return;
    }

    // message specs:
    // origin (43 bytes)
    // signature (86 bytes)
    // type (1 byte)
    // message (base64url encoded without padding, min 1 byte, max 256K)
    // ;
    const pkOrigin: string = re[1];
    const encoder = new TextEncoder();
    const aUdp: Array<Uint8Array> = this.split(
      zlib.brotliCompressSync(encoder.encode(data)),
    );

    // distribute the message to the network, via UDP
    Util.shuffleArray(
      this.arrayBroadcast.filter((pk: string): boolean =>
        pkOrigin !== pk && (!to || to === pk)
      ),
    ).forEach((pk) => {
      Util.shuffleArray(aUdp).forEach((b) => {
        this.samUdp.send(
          this.server.getChain().getPeer(pk as string).udp,
          b as Uint8Array,
        );
      });
    });
  }

  // split message into chunks (of max 12KB size) - max 26 message parts = upper limit of 312KB
  // prefix an 16 byte header: parts (2 byte) and uid (14 byte)
  private split(b: Uint8Array): Array<Uint8Array> {
    const aUdp: Array<Uint8Array> = [];
    let uid: string;
    do {
      uid = this.publicKey.substring(0, 6) + nanoid(8);
    } while (this.arrayMsgUid.includes(uid));
    this.arrayMsgUid.push(uid);
    const chunks: number = Math.ceil(b.length / (12 * 1024)); // 12K chunks
    if (chunks > 90) {
      Log.warn(`${this.server.config.port}: split(), invalid chunk size`);
      return [];
    }
    if (chunks > 1) {
      const size: number = Math.ceil(b.length / chunks);
      for (let c = 0; c < chunks; c++) {
        const chunk: Uint8Array = b.subarray(c * size, (c + 1) * size);
        const parts: Uint8Array = new Uint8Array([33 + c, 33 + chunks - 1]);
        aUdp.push(concat([parts, new TextEncoder().encode(uid), chunk]));
      }
    } else {
      aUdp.push(
        concat([new Uint8Array([33, 33]), new TextEncoder().encode(uid), b]),
      );
    }

    return aUdp;
  }

  getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  getArrayBroadcast(): Array<string> {
    return this.arrayBroadcast;
  }

  private bootstrapNetwork(): void {
    Log.info(
      'Bootstrapping, using: ' + this.server.config.bootstrap + '/network',
    );

    const _i: NodeJS.Timeout = setInterval(async (): Promise<void> => {
      try {
        const clientHttp: Deno.HttpClient = Deno.createHttpClient(
          {
            proxy: {
              transport: 'socks5',
              url: `socks://${this.server.config.i2p_socks}`,
            },
          },
        );
        this.arrayNetwork =
          await (await fetch(this.server.config.bootstrap + '/network', {
            client: clientHttp,
          })).json();
      } catch (error: unknown) {
        Log.warn('Network.populateNetwork() ' + (error as Error).toString());
        this.arrayNetwork = [];
      }
      if (this.arrayNetwork.length) {
        clearInterval(_i);
      }
    }, 10000);
  }

  private isMsgValid(m: string): RegExpMatchArray | false {
    if (m.length < 131) {
      return false;
    }

    // envelope format
    // origin, 43 bytes, base64url encoded
    // signature of type and message, 86 bytes, base64url encoded
    // type, 1 byte, string representation of integer, 1 - 3, see message.ts
    // message, base64url encoded, max 256K
    const re: RegExpMatchArray | null = m.match(
      /^([A-Za-z0-9_-]{43})([A-Za-z0-9_-]{86})([1-3])([A-Za-z0-9_-]{1,262144});/,
    );

    return re?.length === 5 ? re : false;
  }
}
