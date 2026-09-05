/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Server } from '../net/server.ts';
import { Hono } from '@hono/hono/tiny';
import { cors } from '@hono/hono/cors';
import type { Context } from '@hono/hono';
import { Log } from '../logger.ts';

interface IndexEntry {
  key: string;
  value: unknown;
}

interface GroupedSoc {
  role: string;
  shortPk: string;
  publicKey: string;
  namespaces: Record<string, unknown>;
}

export class ApiDebug {
  private server: Server;
  private app: Hono;
  private httpServer: Deno.HttpServer;

  static make(server: Server): ApiDebug {
    return new ApiDebug(server);
  }

  private constructor(server: Server) {
    this.server = server;
    this.app = new Hono({ strict: false });
    this.app.use('*', cors());
    this.route();

    const debugPort: number = this.server.config.port_api_debug;

    this.httpServer = Deno.serve(
      {
        port: debugPort,
        hostname: '127.0.0.1',
        onListen({ port }) {
          Log.warn(`TEST-API (Unprotected) listening on 127.0.0.1:${port}`);
        },
      },
      this.app.fetch,
    );
  }

  public async shutdown(): Promise<void> {
    await this.httpServer.shutdown();
  }

  private route(): void {
    this.app.get('/debug/index', (c: Context) => this.handleIndex(c));
    this.app.get('/debug/ui', (c: Context) => this.handleUi(c));
    this.app.get('/debug/soc/:key', (c: Context) => this.handleSoc(c));
  }

  private parseAliasToNumber(alias: string): number | null {
    const match = alias.match(/^n(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
  }

  private async getGroupedData(isBulk: boolean) {
    const limit = isBulk ? -1 : 100;
    const rawIndex: Array<IndexEntry> = await this.server
      .getChain()
      .searchSocIndex('', limit);

    const configPath: string = Deno.env.get('PATH_CONFIG') || '';
    const matchAlias: RegExpMatchArray | null = configPath.match(/(n\d+)/);
    const rawAlias: string = matchAlias ? matchAlias[1] : 'unknown';
    const localAliasNum: number | null = this.parseAliasToNumber(rawAlias);
    const alias: string = localAliasNum !== null
      ? `n${localAliasNum}`
      : 'unknown';

    const nodePk: string = this.server.getWallet().getNodePublicKey();
    const localSocs: Array<string> = this.server.getWallet().getAllSocs().map((
      s,
    ) => s.publicKey);
    const primaryPk: string = localSocs[0] || '';
    const decoyPks: Array<string> = localSocs.slice(1);

    const groupedMap = new Map<string, GroupedSoc>();

    for (const entry of rawIndex) {
      const parts = entry.key.split(':');
      const pk = parts.pop() || '';
      const namespace = parts.join(':');

      if (!groupedMap.has(pk)) {
        let role = '[FOREIGN_NODE]';
        if (pk === primaryPk) role = '[LOCAL_PRIMARY]';
        else if (decoyPks.includes(pk)) role = '[LOCAL_DECOY]';

        groupedMap.set(pk, {
          role,
          shortPk: pk.substring(0, 8),
          publicKey: pk,
          namespaces: {},
        });
      }

      groupedMap.get(pk)!.namespaces[namespace] = entry.value;
    }

    const allSocs = Array.from(groupedMap.values());
    const primary = allSocs.find((s) => s.role === '[LOCAL_PRIMARY]') || null;
    const decoys = allSocs.filter((s) => s.role === '[LOCAL_DECOY]');
    const foreign = allSocs.filter((s) => s.role === '[FOREIGN_NODE]');

    return {
      node: { alias, publicKey: nodePk },
      primary,
      decoys,
      foreign: limit === -1 ? foreign : foreign.slice(0, limit),
      meta: {
        totalForeign: foreign.length,
        totalDecoys: decoys.length,
        isBulkRequested: isBulk,
      },
    };
  }

  private async handleIndex(c: Context): Promise<Response> {
    const isBulk = c.req.query('bulk') === 'true';
    const data = await this.getGroupedData(isBulk);

    return c.json({
      node: data.node,
      index: {
        primary: data.primary,
        decoys: data.decoys,
        foreign: data.foreign,
      },
      _meta: data.meta,
    });
  }

  private async handleUi(c: Context): Promise<Response> {
    const isBulk = c.req.query('bulk') === 'true';
    const data = await this.getGroupedData(isBulk);

    let rowsHtml = '';

    const renderRow = (soc: GroupedSoc, bgColor: string) => {
      const namespacesStr = Object.entries(soc.namespaces)
        .map(([ns, val]) => `<strong>${ns}</strong>: ${val}`)
        .join('<br>');

      return `
        <tr style="background-color: ${bgColor}; border-bottom: 1px solid #ccc;">
          <td style="padding: 10px; font-weight: bold;">${soc.role}</td>
          <td style="padding: 10px; font-family: monospace;" title="${soc.publicKey}">${soc.shortPk}...</td>
          <td style="padding: 10px; font-family: monospace; font-size: 0.9em;">${namespacesStr}</td>
        </tr>
      `;
    };

    if (data.primary) rowsHtml += renderRow(data.primary, '#d4edda'); // Light green
    data.decoys.forEach((d) => (rowsHtml += renderRow(d, '#e2e3e5'))); // Light gray
    data.foreign.forEach((f) => (rowsHtml += renderRow(f, '#f8d7da'))); // Light red

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>DivaChain Debug: ${data.node.alias}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; background: #f4f4f5; color: #333; }
          h1 { border-bottom: 2px solid #ccc; padding-bottom: 0.5rem; }
          table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          th { background: #333; color: #fff; padding: 10px; text-align: left; }
          .summary { margin-bottom: 1rem; padding: 1rem; background: #fff; border: 1px solid #ccc; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Node Status: ${data.node.alias}</h1>
        <div class="summary">
          <strong>Node Public Key:</strong> <span style="font-family: monospace;">${data.node.publicKey}</span><br>
          <strong>Decoys Managed:</strong> ${data.meta.totalDecoys} | 
          <strong>Foreign SOCs Cached:</strong> ${data.meta.totalForeign}
          ${
      !data.meta.isBulkRequested
        ? '<em>(Showing top 100. Append ?bulk=true for all)</em>'
        : ''
    }
        </div>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Short Key</th>
              <th>Namespaces & Data</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;

    return c.html(html);
  }

  private handleSoc(c: Context): Promise<Response> {
    const pk: string = c.req.param('key') || '';
    return this.exportFullSoc(c, pk);
  }

  private async exportFullSoc(c: Context, pk: string): Promise<Response> {
    const [height] = this.server.getChain().getHeight(pk);

    if (height === 0) {
      return c.notFound();
    }

    const allBlocks = [];
    let currentStart = 1;

    while (currentStart <= height) {
      const chunk = await this.server.getChain().getRange(
        currentStart,
        height,
        pk,
      );
      if (!chunk || chunk.length === 0) break;
      allBlocks.push(...chunk);

      const lastBlock = chunk[chunk.length - 1];
      if (lastBlock.h >= height) break;
      currentStart = lastBlock.h + 1;
    }

    return c.json({ publicKey: pk, height, blocks: allBlocks });
  }
}
