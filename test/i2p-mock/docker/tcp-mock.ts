/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { SamMockBase } from './sam-mock-base.ts';

class TcpMock extends SamMockBase {
  constructor() {
    super();
    this.logPrefix = '[TCP Mock]';
  }

  protected handleSessionCreate(line: string): string {
    const destMatch = line.match(/DESTINATION=([^\s]+)/i);
    const destKey = destMatch ? destMatch[1] : '';
    const responseDest = destKey || 'mock.i2p';
    return `SESSION STATUS RESULT=OK DESTINATION=${responseDest}\n`;
  }

  protected async startProxy(): Promise<void> {
    console.log(
      `${this.logPrefix} Starting SOCKS5 proxy on port ${this.mockPort}...`,
    );
    const listener = Deno.listen({ port: this.mockPort });

    for await (const conn of listener) {
      this.handleConnection(conn).catch((err) =>
        console.error(
          `${this.logPrefix} Connection handler error:`,
          err.message,
        )
      );
    }
  }

  /**
   * Erstellt einen TransformStream, der die Datenpakete verzögert.
   * Simuliert TCP-Retransmits, wenn ein Paket "verloren" geht.
   */
  private createTrafficSimulator() {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: async (chunk, controller) => {
        if (this.mode === 'CLEARNET') {
          controller.enqueue(chunk);
          return;
        }

        // Basis-Latenz (oft etwas schneller als der anfängliche Handshake)
        let delay = this.getLogNormalDistributedDelay() / 2;

        if (Math.random() < this.getCurrentLossRate()) {
          const retransmitSpike = 1500 + (Math.random() * 3000);
          delay += retransmitSpike;

          if (retransmitSpike > 4000) {
            console.log(
              `${this.logPrefix} Extreme TCP retransmit spike simulated: +${
                Math.round(retransmitSpike)
              }ms`,
            );
          }
        }

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        controller.enqueue(chunk);
      },
    });
  }

  private async handleConnection(clientConn: Deno.Conn) {
    try {
      const buf = new Uint8Array(512);

      let n = await clientConn.read(buf);
      if (n === null || buf[0] !== 0x05) {
        clientConn.close();
        return;
      }
      await clientConn.write(new Uint8Array([0x05, 0x00]));

      n = await clientConn.read(buf);
      if (n === null || n < 7 || buf[0] !== 0x05 || buf[1] !== 0x01) {
        clientConn.close();
        return;
      }

      const atyp = buf[3];
      let targetHost = '';
      let offset = 0;

      if (atyp === 0x01) {
        targetHost = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        offset = 8;
      } else if (atyp === 0x03) {
        const domainLen = buf[4];
        targetHost = new TextDecoder().decode(buf.subarray(5, 5 + domainLen));
        offset = 5 + domainLen;
      } else if (atyp === 0x04) {
        offset = 22;
      } else {
        clientConn.close();
        return;
      }

      const targetPort = (buf[offset] << 8) | buf[offset + 1];
      const bareB32 = targetHost.replace('.b32.i2p', '');
      const targetRoute = this.routes.http[targetHost] ||
        this.routes.http[bareB32];

      if (!targetRoute) {
        await clientConn.write(
          new Uint8Array([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientConn.close();
        return;
      }

      const setupDelay = this.getLogNormalDistributedDelay();
      if (setupDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, setupDelay));
      }

      let targetConn: Deno.Conn;
      try {
        targetConn = await Deno.connect({
          hostname: targetRoute.ip,
          port: targetRoute.port,
        });
      } catch (err) {
        await clientConn.write(
          new Uint8Array([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientConn.close();
        return;
      }

      await clientConn.write(
        new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );

      clientConn.readable.pipeThrough(this.createTrafficSimulator()).pipeTo(
        targetConn.writable,
      ).catch(() => {});
      targetConn.readable.pipeThrough(this.createTrafficSimulator()).pipeTo(
        clientConn.writable,
      ).catch(() => {});
    } catch (err) {
      clientConn.close();
    }
  }
}

new TcpMock().start();
