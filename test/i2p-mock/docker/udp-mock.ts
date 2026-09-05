/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { SamMockBase } from './sam-mock-base.ts';

interface QueuedPacket {
  sendAt: number;
  payload: Uint8Array;
  ip: string;
  port: number;
}

class UdpMock extends SamMockBase {
  private sessionToDestination = new Map<string, string>();
  private unassignedKeys: string[] = [];
  private packetQueue: QueuedPacket[] = [];
  private isQueueProcessing = false;

  constructor() {
    super();
    this.logPrefix = '[UDP Mock]';
  }

  // ==========================================================================
  // QUEUEING LOGIC
  // ==========================================================================

  private enqueuePacket(
    payload: Uint8Array,
    ip: string,
    port: number,
    delayMs: number,
    serverConn: Deno.DatagramConn,
  ) {
    const sendAt = Date.now() + delayMs;
    let low = 0;
    let high = this.packetQueue.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.packetQueue[mid].sendAt <= sendAt) low = mid + 1;
      else high = mid;
    }
    this.packetQueue.splice(low, 0, { sendAt, payload, ip, port });

    if (!this.isQueueProcessing) {
      this.processPacketQueue(serverConn);
    }
  }

  private async processPacketQueue(serverConn: Deno.DatagramConn) {
    this.isQueueProcessing = true;

    while (this.packetQueue.length > 0) {
      const now = Date.now();
      const next = this.packetQueue[0];

      if (next.sendAt <= now) {
        const packet = this.packetQueue.shift()!;
        try {
          await serverConn.send(packet.payload, {
            transport: 'udp',
            hostname: packet.ip,
            port: packet.port,
          });
        } catch (_err) {}
      } else {
        const waitMs = Math.min(next.sendAt - now, 20);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    this.isQueueProcessing = false;
  }

  // ==========================================================================
  // SAM OVERRIDES
  // ==========================================================================

  protected handleSessionCreate(line: string): string {
    const idMatch = line.match(/ID=([^\s]+)/i);
    const destMatch = line.match(/DESTINATION=([^\s]+)/i);
    const portMatch = line.match(/(?:PORT|LISTEN_PORT)=([0-9]+)/i);
    const hostMatch = line.match(/(?:HOST|LISTEN_HOST)=([^\s]+)/i);

    const sessionId = idMatch ? idMatch[1] : '';
    const destKey = destMatch ? destMatch[1] : '';
    const portStr = portMatch ? portMatch[1] : '';
    const hostStr = hostMatch ? hostMatch[1] : '172.19.75.1';

    let resolvedBase64 = '';

    if (destKey && this.routes.udp[destKey]) {
      resolvedBase64 = destKey;
    } else if (portStr) {
      const endpointKey = `${hostStr}:${portStr}`;
      if (this.routes.udp_reverse && this.routes.udp_reverse[endpointKey]) {
        resolvedBase64 = this.routes.udp_reverse[endpointKey];
      }
    }

    if (sessionId) {
      resolvedBase64 = this.assignSession(sessionId, resolvedBase64);
    }

    const responseDest = resolvedBase64 || 'mock.i2p';
    return `SESSION STATUS RESULT=OK DESTINATION=${responseDest} PORT=${this.mockPort}\n`;
  }

  private assignSession(sessionId: string, base64Key?: string): string {
    if (this.sessionToDestination.has(sessionId)) {
      return this.sessionToDestination.get(sessionId)!;
    }

    let keyToUse = base64Key;
    if (keyToUse && this.routes.udp && this.routes.udp[keyToUse]) {
      this.unassignedKeys = this.unassignedKeys.filter((k) => k !== keyToUse);
    } else if (this.unassignedKeys.length > 0) {
      keyToUse = this.unassignedKeys.shift()!;
    } else {
      keyToUse = base64Key || '';
    }

    if (keyToUse) {
      this.sessionToDestination.set(sessionId, keyToUse);
    }
    return keyToUse;
  }

  // ==========================================================================
  // PROXY START
  // ==========================================================================

  protected async startProxy(): Promise<void> {
    console.log(
      `${this.logPrefix} Starting SAM datagram proxy on UDP port ${this.mockPort}...`,
    );
    this.unassignedKeys = Object.keys(this.routes.udp || {});

    let conn: Deno.DatagramConn;
    try {
      conn = Deno.listenDatagram({
        port: this.mockPort,
        transport: 'udp',
      });
    } catch (err) {
      console.error(
        `${this.logPrefix} Failed to bind UDP port ${this.mockPort}:`,
        (err as Error).message,
      );
      Deno.exit(1);
    }

    console.log(`${this.logPrefix} Listening for SAM v3 Gossip datagrams...`);

    for await (const [datagram, addr] of conn) {
      this.handleDatagram(datagram, addr as Deno.NetAddr, conn).catch((err) =>
        console.error(`${this.logPrefix} Datagram handler error:`, err.message)
      );
    }
  }

  private async handleDatagram(
    datagram: Uint8Array,
    senderAddr: Deno.NetAddr,
    serverConn: Deno.DatagramConn,
  ) {
    if (Math.random() < this.getCurrentLossRate()) return; // UDP droppt Paket vollständig
    if (datagram.length < 5) return;

    const newlineIndex = datagram.indexOf(10);
    if (newlineIndex === -1) return;

    const headerBytes = datagram.subarray(0, newlineIndex);
    const payload = datagram.subarray(newlineIndex + 1);
    const header = new TextDecoder().decode(headerBytes);
    const headerParts = header.split(' ');
    if (headerParts.length < 3) return;

    const sessionId = headerParts[1];
    const targetBase64 = headerParts[2];

    let senderBase64 = this.sessionToDestination.get(sessionId);
    if (!senderBase64) senderBase64 = this.assignSession(sessionId);

    const targetRoute = this.routes.udp[targetBase64];
    if (!targetRoute) return;

    const deliveryHeader = new TextEncoder().encode(`${senderBase64}\n`);
    const outgoingDatagram = new Uint8Array(
      deliveryHeader.length + payload.length,
    );
    outgoingDatagram.set(deliveryHeader, 0);
    outgoingDatagram.set(payload, deliveryHeader.length);

    this.enqueuePacket(
      outgoingDatagram,
      targetRoute.ip,
      targetRoute.port,
      this.getLogNormalDistributedDelay(),
      serverConn,
    );
  }
}

new UdpMock().start();
