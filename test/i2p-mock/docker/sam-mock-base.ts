/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export abstract class SamMockBase {
  protected routesFile = Deno.env.get('ROUTES_FILE') || '/data/routes.json';
  protected mockPort = parseInt(Deno.env.get('MOCK_PORT') || '0', 10);
  protected samPort = parseInt(Deno.env.get('SAM_PORT') || '7656', 10);
  protected mode = Deno.env.get('SIMULATE_MODE') || 'NORMAL';

  protected routes: any = { udp: {}, udp_reverse: {}, http: {} };
  protected logPrefix = '[Mock]';

  protected abstract startProxy(): Promise<void>;
  protected abstract handleSessionCreate(line: string): string;

  // ==========================================================================
  // SHARED SIMULATION LOGIC (Log-Normal Latency & Chaotic Loss)
  // ==========================================================================

  protected getLogNormalDistributedDelay(): number {
    if (this.mode === 'CLEARNET') return 0;

    const u1 = Math.random() || 0.0001;
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const mu = 6.9; // Median ~992ms
    const sigma = 0.6; // Fat tail spread

    const rawDelay = Math.exp(mu + sigma * z0);
    return Math.max(300, Math.min(8000, Math.round(rawDelay)));
  }

  protected getCurrentLossRate(): number {
    if (this.mode === 'CLEARNET') return 0;

    const now = Date.now() / 1000;
    const wave30m = Math.sin((now / 1800) * 2 * Math.PI);
    const wave11m = Math.sin((now / 673) * 2 * Math.PI + 1.2);
    const wave2m = Math.sin((now / 149) * 2 * Math.PI + 2.5);
    const wave30s = Math.sin((now / 31) * 2 * Math.PI + 0.8);

    const chaoticBase = (wave30m * 0.45) + (wave11m * 0.30) + (wave2m * 0.15) +
      (wave30s * 0.10);
    const baseLoss = 0.15 + (chaoticBase * 0.10);
    const microJitter = (Math.random() - 0.5) * 0.04;

    return Math.max(0.05, Math.min(0.25, baseLoss + microJitter));
  }

  // ==========================================================================
  // SAM CONTROL SERVER
  // ==========================================================================

  public async start() {
    console.log(
      `${this.logPrefix} Starting SAM control bridge on port ${this.samPort}...`,
    );
    console.log(`${this.logPrefix} Running in ${this.mode} mode.`);

    try {
      const routesText = await Deno.readTextFile(this.routesFile);
      this.routes = JSON.parse(routesText);
    } catch (e) {
      console.error(
        `${this.logPrefix} Failed to load routes from ${this.routesFile}:`,
        e,
      );
      Deno.exit(1);
    }

    this.startSamControlServer();
    await this.startProxy();
  }

  private async startSamControlServer() {
    try {
      const listener = Deno.listen({ port: this.samPort });
      for await (const conn of listener) {
        this.handleSamControlConn(conn).catch((err) =>
          console.error(`${this.logPrefix} SAM Control error:`, err.message)
        );
      }
    } catch (err) {
      console.error(
        `${this.logPrefix} Failed to bind SAM Control port ${this.samPort}:`,
        (err as Error).message,
      );
      Deno.exit(1);
    }
  }

  private async handleSamControlConn(conn: Deno.Conn) {
    const buf = new Uint8Array(2048);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    try {
      while (true) {
        const n = await conn.read(buf);
        if (n === null) break;

        buffer += decoder.decode(buf.subarray(0, n));
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          let response = '';
          if (line.startsWith('HELLO VERSION')) {
            response = 'HELLO REPLY RESULT=OK VERSION=3.1\n';
          } else if (line.startsWith('SESSION CREATE')) {
            response = this.handleSessionCreate(line);
          } else if (line.startsWith('NAMING LOOKUP')) {
            console.warn(
              `${this.logPrefix} NAMING LOOKUP requested but is explicitly unsupported in mock environment.`,
            );
            response = `NAMING REPLY RESULT=INVALID_KEY\n`;
          } else if (
            line.startsWith('STREAM CONNECT') ||
            line.startsWith('STREAM ACCEPT')
          ) {
            response = 'STREAM STATUS RESULT=OK\n';
          } else {
            const cmd = line.split(' ')[0];
            response = `${cmd} STATUS RESULT=OK\n`;
          }

          if (response) await conn.write(encoder.encode(response));
        }
      }
    } catch (_err) {
      // Connection closed
    } finally {
      try {
        conn.close();
      } catch (_) {}
    }
  }
}
