/**
 * Copyright (C) 2023-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Level } from 'level';
import path from 'node:path';
import {
  createDatagram,
  createForward,
  I2pSamDatagram,
  I2pSamStream,
  toB32,
} from '@i2p/sam';
import { randomInt } from 'node:crypto';
import { Util } from '../chain/util.ts';
import {
  Config,
  DEFAULT_NETWORK_BROADCAST_FANOUT,
  DEFAULT_NETWORK_STATUS_BROADCAST_MS,
  DEFAULT_SIZE_MESSAGE_CACHE,
  MAX_UDP_MESSAGE_BYTES,
  MIN_UDP_MESSAGE_BYTES,
} from '../config.ts';
import { Log, Telemetry } from '../logger.ts';
import { Server } from './server.ts';
import { Wallet } from '../chain/wallet.ts';
import { Chain } from '../chain/chain.ts';
import {
  Message,
  TYPE_BLOCK_ANNOUNCEMENT,
  TYPE_SLASHING_PROOF,
  TYPE_SOC_ANNOUNCEMENT,
  TYPE_STATUS,
  TYPE_VOTE,
  ValidatedMessage,
} from './message/message.ts';
import { Namespace } from '../chain/namespace.ts';
import { StatusMessage } from './message/status.ts';
import { VoteMessage } from './message/vote.ts';
import { ReputationEntry, ValidatorEntry } from '../chain/block.ts';
import { Economics } from '../chain/economics.ts';

type Status = {
  t: number;
  e: number;
  vrf: string;
  rp: string;
  l: number;
  sig: string;
};

type ArrayStatus = Array<Status>;
type ArrayPublicStatus = Omit<Status, 'l'>;

type ArrayOriginPublicStatus = {
  [origin: string]: Array<ArrayPublicStatus>;
};

export const PEER_STATUS_CITIZEN = 1 as const;
export const PEER_STATUS_GUEST = 2 as const;

export type Peer = {
  publicKey: string;
  http: string;
  udp: string;
  status: typeof PEER_STATUS_CITIZEN | typeof PEER_STATUS_GUEST;
  joinedAtEpoch: number;
};

/** **************************  */
/** protocol related constants */
/** **************************  */

export const BFT_VALIDATORS_SIZE = 31;
export const BFT_EPOCH_TRIGGER_K = 5;
const CELL_CAPACITY = 128;
const GUEST_CAPACITY = 500;
const GUEST_TTL_EPOCHS = 10;
export const REPLICATION_FRACTION: number = 3;
export const REPLICATION_CHUNK_SIZE: number = 50;

export class Network {
  private static readonly P2P_MAX_RETRY_COUNT: number = 120;
  private static readonly P2P_RETRY_INTERVAL_MS: number = 3000;

  private readonly server: Server;
  private readonly wallet: Wallet;
  private readonly chain: Chain;
  private readonly publicKey: string;
  private dbPeer: Level<string, Peer> = {} as Level<string, Peer>;

  private samHttpForward: I2pSamStream = {} as I2pSamStream;
  private samUdp: I2pSamDatagram = {} as I2pSamDatagram;

  private arrayNetwork: Array<Peer> = [];
  private arrayBroadcast: Array<string> = [];

  private mapPeer: Map<string, Peer>;
  private mapHttp: Map<string, string>;
  private mapUdp: Map<string, string>;

  private setIn: Set<string> = new Set();

  private intervalP2P: ReturnType<typeof setInterval> =
    0 as unknown as ReturnType<typeof setInterval>;
  private timeoutStatus: ReturnType<typeof setTimeout> =
    0 as unknown as ReturnType<typeof setTimeout>;

  private mapStatus: Map<string, ArrayStatus> = new Map();

  private textEncoder: TextEncoder = new TextEncoder();
  private textDecoder: TextDecoder = new TextDecoder('utf-8');

  private localEpochTracked: number = 0;
  private localEpochCountK: number = 0;

  // --- CRYPTO CACHE FIELDS ---
  private cachedStatusEpoch: number = 0;
  private cachedVrf: string = '';
  private cachedRp: string = '';
  private cachedSig: string = '';

  // --- LOCKS ---
  private isEnforcingGuestCapacity: boolean = false;
  private isShuttingDown: boolean = false;

  // --- LOCAL-ONLY TELEMETRY (measure network pressure) ---
  private rxUdpBytes: number = 0;
  private txUdpBytes: number = 0;
  private rxHttpBytes: number = 0;
  private txHttpBytes: number = 0;
  private intervalTelemetry: ReturnType<typeof setInterval> =
    0 as unknown as ReturnType<typeof setInterval>;
  private static readonly INTERVAL_TELEMETRY: number = 60000; // 60s

  static async make(server: Server): Promise<Network> {
    const n = new Network(server);
    await n.init();
    return n;
  }

  private constructor(server: Server) {
    this.server = server;
    this.wallet = this.server.getWallet();
    this.chain = this.server.getChain();

    this.publicKey = this.wallet.getNodePublicKey();
    Log.info(`Network, Node ID: ${this.publicKey}`);

    this.mapPeer = new Map();
    this.mapHttp = new Map();
    this.mapUdp = new Map();
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    clearInterval(this.intervalTelemetry);
    clearInterval(this.intervalP2P);
    clearTimeout(this.timeoutStatus);

    try {
      await this.dbPeer.close();
    } catch (e: unknown) {
      Log.warn({ err: e }, 'dbPeer.close() failed');
    }
    try {
      this.samHttpForward.close();
    } catch (e: unknown) {
      Log.warn({ err: e }, 'samHttpForward.close() failed');
    }
    try {
      this.samUdp.close();
    } catch (e: unknown) {
      Log.warn({ err: e }, 'samUdp.close() failed');
    }
  }

  private async init(started: boolean = false, retry: number = 0) {
    retry++;
    if (retry > Network.P2P_MAX_RETRY_COUNT) {
      throw new Error(
        `P2P failed on ${toB32(this.wallet.getUdpAddress())}.b32.i2p`,
      );
    }

    if (this.hasP2PNetwork()) {
      Log.info(`P2P ready on ${toB32(this.wallet.getUdpAddress())}.b32.i2p`);

      if (this.server.config.bootstrap && this.arrayNetwork.length < 3) {
        await this.bootstrap();
      }

      this.timeoutStatus = setTimeout(
        async () => {
          await this.broadcastStatus();
        },
        Math.floor(
          (DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.3) +
            (Math.random() * DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.3),
        ),
      );

      return;
    }

    setTimeout(async () => {
      await this.init(true, retry);
    }, Network.P2P_RETRY_INTERVAL_MS);

    if (!started) {
      Log.info('Loading peers...');
      const pathDbPeer: string = path.join(
        this.server.config.path_soc_index,
        'peers',
      );
      this.dbPeer = new Level(pathDbPeer, {
        valueEncoding: 'json',
        createIfMissing: true,
        errorIfExists: false,
      });
      await this.dbPeer.open();

      const aPeer: Array<Peer> = await this.dbPeer.values().all();
      if (aPeer.length) {
        for (const peer of aPeer) {
          try {
            await this.addPeer(peer);
          } catch (e: unknown) {
            Log.warn(
              { err: e, peer },
              'Network.init(), addPeer from DB failed',
            );
          }
        }
      } else {
        await this.loadSeed();
      }

      Log.info('P2P starting...');
      await this.initHttp(this.server.config);
      await this.initUdp(this.server.config);

      this.intervalP2P = setInterval(() => {
        this.updateP2PNetwork();
      }, this.server.config.network_p2p_interval_ms);

      // Local-only telemetry
      this.intervalTelemetry = setInterval(() => {
        Telemetry.info(
          `UDP (Rx: ${(this.rxUdpBytes / 1024).toFixed(2)} KB, Tx: ${
            (this.txUdpBytes / 1024).toFixed(2)
          } KB) | HTTP (Rx: ${(this.rxHttpBytes / 1024).toFixed(2)} KB, Tx: ${
            (this.txHttpBytes / 1024).toFixed(2)
          } KB) / min`,
        );
        this.rxUdpBytes = 0;
        this.txUdpBytes = 0;
        this.rxHttpBytes = 0;
        this.txHttpBytes = 0;
      }, Network.INTERVAL_TELEMETRY);
    }
  }

  private async loadSeed(): Promise<void> {
    Log.trace(`Loading peers from ${this.server.config.path_peer_seed}`);
    const aPeer: Array<Peer> = JSON.parse(
      await Deno.readTextFile(this.server.config.path_peer_seed),
    );

    aPeer.unshift({
      publicKey: this.publicKey,
      http: this.wallet.getHttpAddress(),
      udp: this.wallet.getUdpAddress(),
      status: PEER_STATUS_CITIZEN,
      joinedAtEpoch: 0,
    });

    for (const p of aPeer) {
      try {
        await this.addPeer(p);
      } catch (err: unknown) {
        Log.warn({ err }, `Failed to add seed peer ${p.publicKey}`);
      }
    }
  }

  private async initHttp(_c: Config): Promise<void> {
    const [http_host, http_port] = _c.i2p_sam_http.split(':');
    const [forward_host, forward_port] = _c.i2p_sam_forward_http.split(':');
    const pubKeys = this.wallet.getI2pPublicKeys();

    try {
      const inboundLV = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      const outboundLV = _c.i2p_sam_tunnel_var_max > 0
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
          publicKey: pubKeys.http.public,
          privateKey: this.wallet.getSamPrivateKey('http'),
        },
        forward: {
          host: forward_host,
          port: Number(forward_port),
          silent: true,
        },
      });
      this.samHttpForward.on(
        'error',
        (e) => Log.warn({ err: e }, 'SAM HTTP OnError'),
      ).on('close', () => Log.info('SAM HTTP close'));
      Log.info(
        `SAM HTTP ready, ${
          toB32(this.wallet.getHttpAddress())
        }.b32.i2p to ${_c.i2p_sam_forward_http}`,
      );
    } catch (e: unknown) {
      Log.warn({ err: e }, 'SAM HTTP error');
      Object.keys(this.samHttpForward).length && this.samHttpForward.close();
      this.samHttpForward = {} as I2pSamStream;
      setTimeout(async () => {
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
    const pubKeys = this.wallet.getI2pPublicKeys();

    try {
      const inboundLV = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;
      const outboundLV = _c.i2p_sam_tunnel_var_max > 0
        ? randomInt(_c.i2p_sam_tunnel_var_min, _c.i2p_sam_tunnel_var_max + 1)
        : 0;

      this.samUdp = await createDatagram({
        session: {
          options:
            `inbound.lengthVariance=${inboundLV} outbound.lengthVariance=${outboundLV}`,
        },
        sam: {
          host: udp_host,
          portTCP: Number(udp_port),
          portUDP: Number(_c.i2p_sam_udp_port_udp),
          publicKey: pubKeys.udp.public,
          privateKey: this.wallet.getSamPrivateKey('udp'),
        },
        listen: {
          address: udp_listen_host,
          port: Number(udp_listen_port),
          hostForward: udp_forward_host,
          portForward: Number(udp_forward_port),
        },
      });
      this.samUdp.on('data', (data, from) => this.onUdpData(data, from))
        .on('close', () => Log.info('SAM UDP close'))
        .on('error', (e) => Log.warn({ err: e }, 'SAM UDP OnError'));
      Log.info(
        `SAM UDP ready, ${
          toB32(this.wallet.getUdpAddress())
        }.b32.i2p listen on ${udp_listen_host}:${Number(udp_listen_port)}`,
      );
    } catch (e: unknown) {
      Log.trace({ err: e }, 'SAM UDP error');
      Object.keys(this.samUdp).length && this.samUdp.close();
      this.samUdp = {} as I2pSamDatagram;
      setTimeout(async () => {
        await this.initUdp(_c);
      }, _c.network_timeout_ms);
    }
  }

  private prepareMessage(data: Uint8Array): [string, null] | [null, Error] {
    try {
      if (
        data.byteLength < MIN_UDP_MESSAGE_BYTES ||
        data.byteLength > MAX_UDP_MESSAGE_BYTES
      ) {
        return [null, new Error('Invalid message length')];
      }
      return [this.textDecoder.decode(data), null];
    } catch (e: unknown) {
      return [null, e instanceof Error ? e : new Error(String(e))];
    }
  }

  private onUdpData(data: Uint8Array, from: string) {
    // local-only telemetry
    this.rxUdpBytes += data.byteLength;

    const pk: string = this.getPublicKeyByUdp(from);
    if (!this.hasPeer(pk)) return;

    if (!this.hasP2PNetwork()) return;

    const [msg, eP] = this.prepareMessage(data);
    if (eP) return;

    const pow: string = msg!.substring(86, 134);
    if (this.setIn.has(pow)) return;

    const [validatedMessage, eV] = this.validateMessage(msg!);
    if (eV || !validatedMessage) return;

    this.setIn.add(pow);
    if (this.setIn.size > DEFAULT_SIZE_MESSAGE_CACHE) {
      const cap = Math.floor(this.setIn.size / 3);
      const iterator = this.setIn.values();
      for (let i = 0; i < cap; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.setIn.delete(next.value);
      }
    }

    (async (): Promise<void> => {
      try {
        switch (validatedMessage.t) {
          case TYPE_VOTE:
            this.server.getValidation().validateVote(
              validatedMessage.struct,
            );
            if (
              !(await this.server.getConsensusFactory().processVote(
                new VoteMessage(validatedMessage.struct, validatedMessage.o),
                validatedMessage.pow,
                validatedMessage.pl,
                validatedMessage.s,
              ))
            ) return;
            break;

          case TYPE_SLASHING_PROOF:
            this.server.getValidation().validateSlashingProof(
              validatedMessage.struct,
            );
            if (
              !(await this.server.getConsensusFactory().processSlashingProof(
                validatedMessage.struct,
              ))
            ) return;
            break;

          case TYPE_BLOCK_ANNOUNCEMENT:
            this.server.getConsensusFactory().processBlockAnnouncement(
              validatedMessage.struct,
              validatedMessage.o,
            );
            break;

          case TYPE_SOC_ANNOUNCEMENT:
            this.server.getValidation().validateSocAnnouncement(
              validatedMessage.struct,
            );

            this.server.getSocSync().processSocAnnouncement(
              validatedMessage.struct,
              validatedMessage.o,
              pk,
            );
            break;

          case TYPE_STATUS: {
            const [consensusBlock, errC] = this.chain.getLatestConsensusBlock();
            if (errC || !consensusBlock) return;

            if (validatedMessage.struct.e > consensusBlock.e) {
              Log.info(
                `Consensus lag: at ${consensusBlock.e}, peer ${validatedMessage.o} is at ${validatedMessage.struct.e}. Triggering state sync...`,
              );
              setTimeout(async () => {
                try {
                  await this.server.getConsensusSync().sync(
                    consensusBlock.e + 1,
                    validatedMessage.o,
                  );
                } catch (e: unknown) {
                  Log.warn(
                    { err: e },
                    'Async consensus sync failed',
                  );
                }
              }, 0);
            }
            if (validatedMessage.struct.e !== consensusBlock.e) {
              return;
            }

            if (
              !Util.verifySignature(
                validatedMessage.o,
                validatedMessage.struct.vrf,
                consensusBlock.ha,
              )
            ) return;

            const aStatus = this.mapStatus.get(validatedMessage.o) || [];
            const tLast = aStatus.length > 0
              ? aStatus[aStatus.length - 1].t + aStatus[aStatus.length - 1].l
              : 0;

            this.server.getValidation().validateStatus(
              validatedMessage.struct,
              tLast,
            );

            const p: { v: boolean; g: boolean } = await this
              .verifyReplicationProof(
                validatedMessage.o,
                validatedMessage.struct.rp,
                consensusBlock.ha,
              );

            if (!p.v) {
              Log.warn(`Replication Proof failed for ${validatedMessage.o}`);
              return;
            }

            this.processStatus(
              new StatusMessage(validatedMessage.struct, validatedMessage.o),
            );
            break;
          }
        }
      } catch (e: unknown) {
        Log.trace({ err: e }, 'Message processing failed');
        return;
      }
      this.broadcast(msg!, validatedMessage.o, pk);
    })();
  }

  private validateMessage(
    m: string,
  ): [ValidatedMessage & { pl: string }, null] | [null, Error] {
    const re = m.match(
      /^(?<s>[A-Za-z0-9_-]{86})(?<pow>[A-Za-z0-9_-]{48})(?<pl>(?<o>[A-Za-z0-9_-]{43})(?<ty>[1-9])(?<json>[\s\S]+))$/s,
    );
    if (!re || !re.groups) return [null, new Error('Invalid message format')];

    const { s, pow, pl, o, ty, json } = re.groups;
    const t: number = Number(ty);

    switch (t) {
      case TYPE_VOTE:
      case TYPE_STATUS:
      case TYPE_BLOCK_ANNOUNCEMENT:
      case TYPE_SLASHING_PROOF:
      case TYPE_SOC_ANNOUNCEMENT:
        break;
      default:
        return [null, new Error('Invalid message type')];
    }

    if (t !== TYPE_SOC_ANNOUNCEMENT && !this.hasPeer(o)) {
      return [null, new Error('Message from unknown origin')];
    }
    if (!Message.verifyPoW(pow, pl)) {
      return [null, new Error('Message has invalid PoW')];
    }
    if (!Util.verifySignature(o, s, pow + pl)) {
      return [null, new Error('Message has invalid signature')];
    }

    try {
      return [
        { t, struct: JSON.parse(json), o, pow, s, pl } as unknown as
          & ValidatedMessage
          & { pl: string },
        null,
      ];
    } catch (_error) {
      return [null, new Error('Message has invalid JSON')];
    }
  }

  private async getReplicationTarget(
    origin: string,
    consensusHash: string,
  ): Promise<string | null> {
    const repList = await this.chain.getLatestReputation();
    if (!repList || typeof repList === 'number') return null;

    const citizens = repList.map((r) => r.pk).filter((pk) => pk !== origin);
    if (citizens.length === 0) return null;

    const dynamicNeighborhoodSize = Math.max(
      1,
      Math.floor(citizens.length / REPLICATION_FRACTION),
    );

    const neighbors = citizens
      .map((pk) => ({ pk, distance: Util.xorDistance(origin, pk) }))
      .sort((a, b) => (a.distance < b.distance ? -1 : 1))
      .slice(0, dynamicNeighborhoodSize);

    let hashSum = 0;
    for (let i = 0; i < consensusHash.length; i++) {
      hashSum += consensusHash.charCodeAt(i);
    }
    return neighbors[hashSum % neighbors.length].pk;
  }

  private async verifyReplicationProof(
    origin: string,
    rp: string,
    consensusHash: string,
  ): Promise<{ v: boolean; g: boolean }> {
    const repData = await this.chain.getLatestReputation(origin);
    const originReputation = typeof repData === 'number' ? repData : 0;

    if (originReputation > 0) return { v: true, g: false };

    const targetPeer: string | null = await this.getReplicationTarget(
      origin,
      consensusHash,
    );
    let chunkPayload: string = '[]';

    if (targetPeer) {
      const [targetHeight, errH] = this.chain.getHeight(targetPeer);

      if (!errH && targetHeight > 0) {
        let startIndex: number = 1;
        let endIndex: number = targetHeight;

        if (targetHeight > REPLICATION_CHUNK_SIZE) {
          const maxStartIndex = targetHeight - REPLICATION_CHUNK_SIZE + 1;
          let hashSum: number = 0;
          for (let i = 0; i < consensusHash.length; i++) {
            hashSum += consensusHash.charCodeAt(i);
          }

          startIndex = (hashSum % maxStartIndex) + 1;
          endIndex = startIndex + REPLICATION_CHUNK_SIZE - 1;
        }

        const chunk = await this.chain.getRange(
          startIndex,
          endIndex,
          targetPeer,
        );
        if (chunk && chunk.length > 0) {
          chunkPayload = JSON.stringify(chunk.map((b) => b.cs));
        }
      }
    }

    const expectedString = consensusHash + chunkPayload;
    return { v: rp === Util.hashString(expectedString), g: true };
  }

  private hasP2PNetwork(): boolean {
    return (
      this.arrayNetwork.length === [...this.getMapPeer().values()].length &&
      Object.keys(this.samHttpForward).length > 0 &&
      Object.keys(this.samUdp).length > 0
    );
  }

  private updateP2PNetwork() {
    const aNetwork: Array<Peer> = [...this.getMapPeer().values()];
    const [, err] = this.chain.getHeight(this.publicKey);
    if (
      err || !Object.keys(this.samHttpForward).length ||
      !Object.keys(this.samUdp).length
    ) return;

    this.arrayNetwork = aNetwork.sort((
      p1,
      p2,
    ) => (p1.publicKey > p2.publicKey ? 1 : -1));
    this.arrayBroadcast = this.arrayNetwork.map((p) => p.publicKey).filter((
      pk,
    ) => pk !== this.publicKey);
  }

  private async broadcastStatus() {
    const [consensusBlock, errC] = this.chain.getLatestConsensusBlock();

    this.timeoutStatus = setTimeout(
      async () => {
        await this.broadcastStatus();
      },
      Math.floor(
        (DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.95) +
          (Math.random() * DEFAULT_NETWORK_STATUS_BROADCAST_MS * 0.08),
      ),
    );

    if (this.server.getConsensusSync().isSyncing()) {
      Log.trace('Gossip muted: node is currently syncing.');
      return;
    }

    if (errC || !consensusBlock) {
      Log.warn(
        { errC },
        'broadcastStatus() failed: Chain/Consensus not ready',
      );
      return;
    }

    if (this.localEpochTracked !== consensusBlock.e) {
      this.localEpochTracked = consensusBlock.e;
      this.localEpochCountK = 0;

      await this.runEvictionSweep(consensusBlock.e);
    }

    if (this.cachedStatusEpoch !== consensusBlock.e) {
      // Node ID signatures for BFT participation
      this.cachedVrf = this.wallet.vrfNode(consensusBlock.ha);

      let rp: string = Util.hashString(consensusBlock.ha + '[]');
      const myRepData = await this.chain.getLatestReputation(this.publicKey);
      const myReputation: number = typeof myRepData === 'number'
        ? myRepData
        : 0;

      if (myReputation === 0) {
        const targetPeer = await this.getReplicationTarget(
          this.publicKey,
          consensusBlock.ha,
        );

        if (targetPeer) {
          let chunkPayload = '[]';
          const [targetHeight, errH] = this.chain.getHeight(targetPeer);

          if (!errH && targetHeight > 0) {
            let startIndex = 1;
            let endIndex = targetHeight;

            if (targetHeight > REPLICATION_CHUNK_SIZE) {
              const maxStartIndex = targetHeight - REPLICATION_CHUNK_SIZE + 1;
              let hashSum = 0;
              for (let i = 0; i < consensusBlock.ha.length; i++) {
                hashSum += consensusBlock.ha.charCodeAt(i);
              }

              startIndex = (hashSum % maxStartIndex) + 1;
              endIndex = startIndex + REPLICATION_CHUNK_SIZE - 1;
            }

            const chunk = await this.chain.getRange(
              startIndex,
              endIndex,
              targetPeer,
            );
            if (chunk && chunk.length > 0) {
              chunkPayload = JSON.stringify(chunk.map((b) => b.cs));
            }
          }
          const challengeString = consensusBlock.ha + chunkPayload;
          rp = Util.hashString(challengeString);
        }
      }
      this.cachedRp = rp;

      const expectedMessage: string = `${consensusBlock.e}`;
      this.cachedSig = this.wallet.signNode(expectedMessage);

      this.cachedStatusEpoch = consensusBlock.e;
    }

    const sm: StatusMessage = new StatusMessage({
      t: Date.now(),
      e: consensusBlock.e,
      vrf: this.cachedVrf,
      rp: this.cachedRp,
      sig: this.cachedSig,
    }, this.publicKey);

    this.processStatus(sm);
    this.broadcast(await sm.asString(this.wallet));

    this.localEpochCountK++;
    if (this.localEpochCountK === BFT_EPOCH_TRIGGER_K) {
      Log.info(
        `Epoch ${consensusBlock.e}: Event-Clock reached K=${BFT_EPOCH_TRIGGER_K}`,
      );
      this.server.getConsensusFactory().triggerEpochChange(consensusBlock.e);
    }
  }

  public async hasQuorumBFT(n: number): Promise<boolean> {
    const [consensusBlock, err] = this.chain.getLatestConsensusBlock();

    if (!err) {
      const state = await this.chain.getReputationState(
        Namespace.validatorsForEpoch(consensusBlock.e),
      );
      if (state) {
        try {
          const validators: Array<ValidatorEntry> = JSON.parse(state.value);
          return n >= Math.floor(validators.length * 2 / 3) + 1;
        } catch (e: unknown) {
          Log.warn({ err: e }, 'hasQuorumBFT: Failed to parse validators');
        }
      }
    }

    return n >= Math.floor(this.arrayNetwork.length * 2 / 3) + 1;
  }

  public broadcast(msg: string, origin: string = '', from: string = ''): void {
    if (this.isShuttingDown) return;

    const a: Array<string> = Util.shuffleArray(
      this.arrayBroadcast.filter((pk) => origin !== pk && from !== pk),
    );
    if (!a.length) return;

    if (this.server.getConsensusSync().isSyncing()) {
      return;
    }

    const msgUdp: Uint8Array<ArrayBufferLike> = this.textEncoder.encode(msg);

    if (
      msgUdp.byteLength < MIN_UDP_MESSAGE_BYTES ||
      msgUdp.byteLength > MAX_UDP_MESSAGE_BYTES
    ) {
      Log.warn(`UDP payload too large (${msgUdp.byteLength} bytes).`);
      return;
    }

    const variance = Math.floor(Math.random() * 7) - 3; // generates -3 till +3
    const dynamicFanout = DEFAULT_NETWORK_BROADCAST_FANOUT + variance;
    a.slice(0, dynamicFanout).forEach((pk, i) => {
      const peer = this.getPeer(pk);
      if (!peer || !peer.udp) return;

      try {
        this.samUdp.send(peer.udp, msgUdp);
        this.txUdpBytes += msgUdp.byteLength; // local-only telemetry
        if (i % 2 === 0) {
          setTimeout(() => {
            try {
              if (this.isShuttingDown) return;
              this.samUdp.send(peer.udp, msgUdp);
              this.txUdpBytes += msgUdp.byteLength; // local-only telemetry
            } catch (_e) { /* ignore */ }
          }, 1000);
        }
      } catch (e: unknown) {
        Log.trace({ err: e }, `UDP broadcast failed to ${peer.udp}`);
      }
    });
  }

  public getArrayNetwork(): Array<Peer> {
    return this.arrayNetwork;
  }

  public getArrayBroadcast(): Array<string> {
    return this.arrayBroadcast;
  }

  private processStatus(status: StatusMessage) {
    const origin: string = status.getOrigin();
    let aStatus: ArrayStatus = this.mapStatus.get(origin) || [];

    const currentEpoch = this.chain.getCurrentEpoch();
    const minEpoch = Math.max(1, currentEpoch - 3);
    aStatus = aStatus.filter((s) => s.e >= minEpoch);

    aStatus.push({
      t: status.t(),
      e: status.e(),
      vrf: status.vrf(),
      rp: status.rp(),
      l: Date.now() - status.t(),
      sig: status.sig(),
    });

    this.setStatus(origin, aStatus);
  }

  private setStatus(origin: string, aStatus: ArrayStatus) {
    this.mapStatus.set(origin, aStatus);
  }

  public getStatus(origin: string = ''): ArrayOriginPublicStatus {
    const filterStatus = (arr: ArrayStatus) =>
      arr.map((s) => ({
        t: s.t,
        e: s.e,
        vrf: s.vrf,
        rp: s.rp,
        sig: s.sig,
      }));

    if (origin) {
      return { [origin]: filterStatus(this.mapStatus.get(origin) || []) };
    }

    const publicStatus: ArrayOriginPublicStatus = {};
    for (const [key, value] of this.mapStatus.entries()) {
      publicStatus[key] = filterStatus(value);
    }
    return publicStatus;
  }

  public getPeersByEpoch(
    epoch: number,
    minEpochMode: boolean = false,
  ): Array<string> {
    const peers: Array<string> = [];

    for (const [pk, aStatus] of this.mapStatus.entries()) {
      if (aStatus.length === 0) continue;

      if (minEpochMode) {
        if (aStatus[aStatus.length - 1].e >= epoch) {
          peers.push(pk);
        }
      } else {
        for (let i = aStatus.length - 1; i >= 0; i--) {
          if (aStatus[i].e === epoch) {
            peers.push(pk);
            break;
          }
          if (aStatus[i].e < epoch) break;
        }
      }
    }
    return peers;
  }

  public getNextValidators(
    currentEpoch: number,
    currentValidators: Array<ValidatorEntry>,
    reputationTable: Array<ReputationEntry> = [],
  ): Array<ValidatorEntry> {
    const repMap = new Map<string, number>(
      reputationTable.map((r) => [r.pk, r.r]),
    );
    const candidates: Array<{ pk: string; vrf: string; score: number }> = [];

    for (const [pk, aStatus] of this.mapStatus.entries()) {
      let validStatus = null;
      for (let i = aStatus.length - 1; i >= 0; i--) {
        const msg = aStatus[i];
        if (msg.e === currentEpoch) {
          validStatus = msg;
          break;
        }
        if (msg.e < currentEpoch) break;
      }
      if (!validStatus) continue;

      const rScore = repMap.get(pk) ?? 0;
      candidates.push({ pk: pk, vrf: validStatus.vrf, score: rScore });
    }

    const thresholdVeteran = 480 * Economics.REPUTATION_BUILD_STEP_UPTIME;
    const thresholdNewcomer = 48 * Economics.REPUTATION_BUILD_STEP_UPTIME;

    const poolVeterans = candidates.filter((c) => c.score >= thresholdVeteran);
    const poolNewcomers = candidates.filter((c) =>
      c.score >= thresholdNewcomer && c.score < thresholdVeteran
    );
    const poolGuests = candidates.filter((c) => c.score < thresholdNewcomer);

    const sortByVrf = (a: { vrf: string }, b: { vrf: string }) =>
      a.vrf > b.vrf ? 1 : -1;
    poolVeterans.sort(sortByVrf);
    poolNewcomers.sort(sortByVrf);
    poolGuests.sort(sortByVrf);

    const nextValidators: Array<ValidatorEntry> = [];

    const targetVeterans = Math.floor(BFT_VALIDATORS_SIZE * 0.85);
    const targetNewcomers = BFT_VALIDATORS_SIZE - targetVeterans;

    nextValidators.push(
      ...poolVeterans.splice(0, targetVeterans).map((c) => ({
        pk: c.pk,
        vrf: c.vrf,
      })),
    );
    nextValidators.push(
      ...poolNewcomers.splice(0, targetNewcomers).map((c) => ({
        pk: c.pk,
        vrf: c.vrf,
      })),
    );

    const remainingCandidates = [
      ...poolVeterans,
      ...poolNewcomers,
      ...poolGuests,
    ].sort(sortByVrf);

    while (
      nextValidators.length < BFT_VALIDATORS_SIZE &&
      remainingCandidates.length > 0
    ) {
      const fallbackCandidate = remainingCandidates.shift();
      if (fallbackCandidate) {
        nextValidators.push({
          pk: fallbackCandidate.pk,
          vrf: fallbackCandidate.vrf,
        });
      }
    }

    if (nextValidators.length < BFT_VALIDATORS_SIZE) {
      for (const currentVal of currentValidators) {
        if (nextValidators.length >= BFT_VALIDATORS_SIZE) break;
        if (!nextValidators.find((v) => v.pk === currentVal.pk)) {
          nextValidators.push(currentVal);
        }
      }
    }

    return nextValidators;
  }

  public getMapPeer(): Map<string, Peer> {
    return this.mapPeer;
  }

  public getListPeer(): Array<string> {
    return [...this.mapPeer.keys()].sort();
  }

  public hasPeer(publicKey: string): boolean {
    return this.mapPeer.has(publicKey);
  }

  public getPeer(publicKey: string): Peer | undefined {
    return this.mapPeer.get(publicKey);
  }

  public getPublicKeyByHttp(http: string): string {
    return this.mapHttp.get(http) || '';
  }

  public getPublicKeyByUdp(udp: string): string {
    return this.mapUdp.get(udp) || '';
  }

  public hasNetworkHttp(http: string): boolean {
    return this.mapHttp.has(http);
  }

  public async addPeer(peer: Peer): Promise<boolean> {
    if (this.mapPeer.has(peer.publicKey)) return false;

    const repData = await this.chain.getLatestReputation(peer.publicKey);
    const reputation = typeof repData === 'number' ? repData : 0;
    const isCitizen = reputation > 0;

    let citizenCount = 0;
    let guestCount = 0;

    for (const p of this.mapPeer.values()) {
      if (p.status === PEER_STATUS_CITIZEN) citizenCount++;
      else guestCount++;
    }

    if (isCitizen) {
      if (citizenCount >= CELL_CAPACITY) {
        Log.warn(
          `addPeer: Cell capacity reached. Cannot add citizen ${peer.publicKey}`,
        );
        return false;
      }
    } else {
      if (guestCount >= GUEST_CAPACITY) {
        await this.enforceGuestCapacity();
      }
    }

    const fullPeer: Peer = {
      publicKey: peer.publicKey,
      http: peer.http,
      udp: peer.udp,
      status: isCitizen ? PEER_STATUS_CITIZEN : PEER_STATUS_GUEST,
      joinedAtEpoch: this.chain.getCurrentEpoch(),
    };

    this.mapPeer.set(fullPeer.publicKey, fullPeer);
    await this.dbPeer.put(fullPeer.publicKey, fullPeer);
    this.mapHttp.set(fullPeer.http, fullPeer.publicKey);
    this.mapUdp.set(fullPeer.udp, fullPeer.publicKey);

    // Only register external peers with Chain. Local keys are managed by Chain directly.
    if (fullPeer.publicKey !== this.publicKey) {
      await this.server.getChain().addSoc(fullPeer.publicKey);
    }
    return true;
  }

  public async removePeer(publicKey: string): Promise<void> {
    if (publicKey === this.publicKey || !this.mapPeer.has(publicKey)) return;
    const peer = this.mapPeer.get(publicKey) as Peer;
    this.mapPeer.delete(publicKey);
    this.mapHttp.delete(peer.http);
    await this.dbPeer.del(publicKey);
    this.server.getChain().removeSoc(publicKey);
  }

  private async bootstrap(): Promise<void> {
    const aBootstrap = this.server.config.bootstrap.split(',').map((s) =>
      s.trim()
    );
    await this.server.getConsensusSync().sync();

    const myPk = this.publicKey;
    const myHttp = this.wallet.getHttpAddress();
    const myUdp = this.wallet.getUdpAddress();

    for await (const p of aBootstrap) {
      if (!Util.isI2pBase32Address(p)) {
        Log.warn(`Ignored invalid bootstrap seed: ${p}`);
        continue;
      }

      const r: Response = await this.server.fetchFromApi(
        `http://${p}/network/`,
      );
      const aPeer: Array<Peer> = r.ok ? await r.json() : [];

      for await (const peer of aPeer) {
        if (peer.publicKey !== myPk && !this.hasPeer(peer.publicKey)) {
          await this.addPeer(peer);

          const targetHttp = `${toB32(peer.http)}.b32.i2p`;
          const introduceUrl =
            `http://${targetHttp}/network/introduce?pk=${myPk}&http=${myHttp}&udp=${myUdp}`;

          this.server.fetchFromApi(introduceUrl, 0).catch(() => {});
        }
      }
    }
  }

  private async runEvictionSweep(currentEpoch: number): Promise<void> {
    for (const [pk, peer] of this.mapPeer.entries()) {
      if (pk === this.publicKey) continue;

      if (peer.status === PEER_STATUS_GUEST) {
        const ageInEpochs = currentEpoch - peer.joinedAtEpoch;

        if (ageInEpochs >= GUEST_TTL_EPOCHS) {
          const repData = await this.chain.getLatestReputation(pk);
          const reputation = repData ? repData : 0;

          if (reputation === 0) {
            Log.info(`Evicting guest ${pk} for failing to become a citizen.`);
            await this.removePeer(pk);
            this.mapStatus.delete(pk);
          } else {
            Log.info(`Guest ${pk} successfully naturalized as Citizen!`);
            peer.status = PEER_STATUS_CITIZEN;
            await this.dbPeer.put(pk, peer);
          }
        }
      }
    }
  }

  private async enforceGuestCapacity(): Promise<void> {
    if (this.isEnforcingGuestCapacity) return;
    this.isEnforcingGuestCapacity = true;

    try {
      let guestCount = 0;
      for (const p of this.mapPeer.values()) {
        if (p.status === PEER_STATUS_GUEST) guestCount++;
      }

      if (guestCount >= GUEST_CAPACITY) {
        const cap = Math.floor(guestCount / 3) + 1;
        let evicted = 0;

        for (const [pk, peer] of this.mapPeer.entries()) {
          if (peer.status === PEER_STATUS_GUEST) {
            await this.removePeer(pk);
            this.mapStatus.delete(pk);
            evicted++;
            if (evicted >= cap) break;
          }
        }
        Log.info(
          `Guest capacity enforced: Evicted ${evicted} oldest guests to free space.`,
        );
      }
    } finally {
      this.isEnforcingGuestCapacity = false;
    }
  }

  // local-only telemetry
  public addHttpRx(bytes: number) {
    this.rxHttpBytes += bytes;
  }
  public addHttpTx(bytes: number) {
    this.txHttpBytes += bytes;
  }
}
