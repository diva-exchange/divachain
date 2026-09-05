/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { toB32 } from '@i2p/sam';
import { join } from 'node:path';

const pathApp: string = Deno.cwd();
const DEVNET_DIR = join(pathApp, 'test', 'data', 'dev');
const ROUTES_OUT = join(DEVNET_DIR, 'routes.json');

type RouteTarget = { ip: string; port: number };

interface Routes {
  http: Record<string, RouteTarget>;
  udp: Record<string, RouteTarget>;
  udp_reverse: Record<string, string>;
}

const routes: Routes = {
  http: {},
  udp: {},
  udp_reverse: {},
};

let processedCount = 0;

try {
  for (const dirEntry of Deno.readDirSync(DEVNET_DIR)) {
    if (!dirEntry.isDirectory) continue;

    const folderName = dirEntry.name;

    const match = folderName.match(/(n|dev)(\d+)$/);
    if (match) {
      const seedPath = join(DEVNET_DIR, folderName, 'db', 'peer-seed.json');
      const peerSeeds = JSON.parse(Deno.readTextFileSync(seedPath));

      const nodeIndex = parseInt(match[2], 10);
      const peer = peerSeeds[nodeIndex];
      if (!peer) continue;

      const configPath = join(DEVNET_DIR, folderName, 'config.json');

      try {
        const configText = Deno.readTextFileSync(configPath);
        const config = JSON.parse(configText);

        // --- 1. HTTP / SOCKS5 Routing ---
        if (peer.http && config.i2p_sam_forward_http && config.port) {
          const b32Http = toB32(peer.http);
          const [httpIp] = config.i2p_sam_forward_http.split(':');

          routes.http[b32Http] = {
            ip: httpIp,
            port: config.port,
          };
        }

        // --- 2. UDP Routing (Forward & Reverse) ---
        if (peer.udp && config.i2p_sam_listen_udp) {
          const b64Udp = peer.udp;
          const [udpIp, udpPortStr] = config.i2p_sam_listen_udp.split(':');
          const udpPort = parseInt(udpPortStr, 10);

          routes.udp[b64Udp] = {
            ip: udpIp,
            port: udpPort,
          };

          const senderSignature = `${udpIp}:${udpPort}`;
          routes.udp_reverse[senderSignature] = b64Udp;
        }

        processedCount++;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) continue;
        console.error(
          `Error processing folder ${folderName}:`,
          (err as Error).message,
        );
      }
    }
  }

  Deno.writeTextFileSync(ROUTES_OUT, JSON.stringify(routes, null, 2));
  console.log(
    `Successfully generated routes.json in ${ROUTES_OUT} for ${processedCount} nodes!`,
  );
} catch (err) {
  console.error(
    `Critical error reading base directory ${DEVNET_DIR}:`,
    (err as Error).message,
  );
  Deno.exit(1);
}
