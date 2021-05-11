/**
 * Copyright (C) 2021 diva.exchange
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
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import path from 'path';
import * as fs from 'fs';

export type Configuration = {
  p2p_ip?: string;
  p2p_port?: number;
  http_ip?: string;
  http_port?: number;
  per_message_deflate?: boolean;
  max_blocks_in_memory?: number;
  path_genesis?: string;
  path_blockstore?: string;
  path_state?: string;
  path_keys?: string;

  socks_proxy_host?: string;
  socks_proxy_port?: number;

  network_size?: number;
  network_morph_interval_ms?: number;
  network_refresh_interval_ms?: number;
  network_auth_timeout_ms?: number;
  network_clean_interval_ms?: number;
  network_ping_interval_ms?: number;
};

const DEFAULT_NETWORK_SIZE = 7;
const DEFAULT_NAME_GENESIS_BLOCK = 'block';

export class Config {
  public readonly p2p_ip: string;
  public readonly p2p_port: number;
  public readonly http_ip: string;
  public readonly http_port: number;
  public readonly per_message_deflate: boolean;
  public readonly max_blocks_in_memory: number;
  public readonly path_genesis: string;
  public readonly path_blockstore: string;
  public readonly path_state: string;
  public readonly path_keys: string;
  public readonly socks_proxy_host: string;
  public readonly socks_proxy_port: number;
  public readonly network_size: number;
  public readonly network_morph_interval_ms: number;
  public readonly network_refresh_interval_ms: number;
  public readonly network_auth_timeout_ms: number;
  public readonly network_clean_interval_ms: number;
  public readonly network_ping_interval_ms: number;

  constructor(c: Configuration = {}) {
    const nameBlockGenesis = (process.env.NAME_BLOCK_GENESIS || DEFAULT_NAME_GENESIS_BLOCK).replace(
      /[^a-z0-9_-]/gi,
      ''
    );

    this.p2p_ip = c.p2p_ip || process.env.P2P_IP || '127.0.0.1';
    this.p2p_port = c.p2p_port || Number(process.env.P2P_PORT) || 17468;
    this.http_ip = c.http_ip || process.env.HTTP_IP || '127.0.0.1';
    this.http_port = c.http_port || Number(process.env.HTTP_PORT) || 17469;
    this.per_message_deflate = c.per_message_deflate || true;
    this.max_blocks_in_memory = c.max_blocks_in_memory || 1000;
    this.path_genesis = c.path_genesis || path.join(__dirname, `../genesis/${nameBlockGenesis}.json`);
    this.path_blockstore = c.path_blockstore || path.join(__dirname, '../blockstore/');
    this.path_state = c.path_state || path.join(__dirname, '../state/');
    this.path_keys = c.path_keys || path.join(__dirname, '../keys/');
    if (!fs.existsSync(this.path_keys)) {
      fs.mkdirSync(this.path_keys, { mode: '755', recursive: true });
    }

    this.socks_proxy_host = c.socks_proxy_host || process.env.SOCKS_PROXY_HOST || '';
    this.socks_proxy_port = c.socks_proxy_port || Number(process.env.SOCKS_PROXY_PORT) || 0;

    this.network_size =
      c.network_size || Number(process.env.NETWORK_SIZE) || 0 > DEFAULT_NETWORK_SIZE
        ? Math.floor(c.network_size || Number(process.env.NETWORK_SIZE))
        : DEFAULT_NETWORK_SIZE;
    this.network_morph_interval_ms =
      c.network_morph_interval_ms || Number(process.env.NETWORK_MORPH_INTERVAL_MS) || 180000;

    this.network_refresh_interval_ms =
      c.network_refresh_interval_ms || Number(process.env.NETWORK_REFRESH_INTERVAL_MS) || 3000;
    this.network_auth_timeout_ms =
      c.network_auth_timeout_ms || Number(process.env.NETWORK_AUTH_TIMEOUT_MS) || this.network_refresh_interval_ms * 10;
    this.network_ping_interval_ms = c.network_ping_interval_ms || Number(process.env.NETWORK_PING_INTERVAL_MS) || 2000;
    this.network_clean_interval_ms = this.network_size * this.network_ping_interval_ms * 2;
  }
}
