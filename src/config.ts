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
  max_blocks_in_memory?: number;
  network_sync_threshold?: number;
  network_sync_size?: number;
  network_verbose_logging?: boolean;

  block_pool_check_interval_ms?: number;
};

const DEFAULT_P2P_PORT = 17468;
const DEFAULT_HTTP_PORT = 17469;
const DEFAULT_MAX_BLOCKS_IN_MEMORY = 1000;
const DEFAULT_NAME_GENESIS_BLOCK = 'block';

const MIN_NETWORK_SIZE = 7;
const MAX_NETWORK_SIZE = 64;
const MIN_NETWORK_MORPH_INTERVAL_MS = 120000;
const MAX_NETWORK_MORPH_INTERVAL_MS = 600000;
const DEFAULT_NETWORK_REFRESH_INTERVAL_MS = 3000;
const DEFAULT_NETWORK_PING_INTERVAL_MS = 2000;
const DEFAULT_NETWORK_SYNC_THRESHOLD = 1;
const DEFAULT_NETWORK_SYNC_SIZE = 10;
const DEFAULT_BLOCK_POOL_CHECK_INTERVAL_MS = 10000;

export class Config {
  public readonly p2p_ip: string;
  public readonly p2p_port: number;
  public readonly http_ip: string;
  public readonly http_port: number;
  public readonly per_message_deflate: boolean;
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
  public readonly max_blocks_in_memory: number;
  public readonly network_sync_threshold: number;
  public readonly network_sync_size: number;
  public readonly network_verbose_logging: boolean;
  public readonly block_pool_check_interval_ms: number;

  constructor(c: Configuration = {}) {
    const nameBlockGenesis = (process.env.NAME_BLOCK_GENESIS || DEFAULT_NAME_GENESIS_BLOCK).replace(
      /[^a-z0-9_-]/gi,
      ''
    );

    this.p2p_ip = c.p2p_ip || process.env.P2P_IP || '127.0.0.1';
    this.p2p_port = Config.port(c.p2p_port || process.env.P2P_PORT || DEFAULT_P2P_PORT);
    this.http_ip = c.http_ip || process.env.HTTP_IP || '127.0.0.1';
    this.http_port = Config.port(c.http_port || process.env.HTTP_PORT || DEFAULT_HTTP_PORT);
    this.per_message_deflate = c.per_message_deflate || true;
    this.path_genesis = c.path_genesis || path.join(__dirname, `../genesis/${nameBlockGenesis}.json`);
    this.path_blockstore = c.path_blockstore || path.join(__dirname, '../blockstore/');
    this.path_state = c.path_state || path.join(__dirname, '../state/');
    this.path_keys = c.path_keys || path.join(__dirname, '../keys/');
    if (!fs.existsSync(this.path_keys)) {
      fs.mkdirSync(this.path_keys, { mode: '755', recursive: true });
    }

    this.max_blocks_in_memory = Config.gte1(
      c.max_blocks_in_memory || process.env.NETWORK_MAX_BLOCKS_IN_MEMORY || DEFAULT_MAX_BLOCKS_IN_MEMORY
    );

    this.socks_proxy_host = c.socks_proxy_host || process.env.SOCKS_PROXY_HOST || '';
    this.socks_proxy_port = Config.port(c.socks_proxy_port || process.env.SOCKS_PROXY_PORT);

    this.network_size = Config.b(c.network_size || process.env.NETWORK_SIZE, MIN_NETWORK_SIZE, MAX_NETWORK_SIZE);
    this.network_morph_interval_ms = Config.b(
      c.network_morph_interval_ms || process.env.NETWORK_MORPH_INTERVAL_MS,
      MIN_NETWORK_MORPH_INTERVAL_MS,
      MAX_NETWORK_MORPH_INTERVAL_MS
    );

    this.network_refresh_interval_ms = Config.gte1(
      c.network_refresh_interval_ms || process.env.NETWORK_REFRESH_INTERVAL_MS,
      DEFAULT_NETWORK_REFRESH_INTERVAL_MS
    );
    this.network_auth_timeout_ms = Config.gte1(
      c.network_auth_timeout_ms || process.env.NETWORK_AUTH_TIMEOUT_MS,
      this.network_refresh_interval_ms * 5
    );
    this.network_ping_interval_ms = Config.gte1(
      c.network_ping_interval_ms || process.env.NETWORK_PING_INTERVAL_MS,
      DEFAULT_NETWORK_PING_INTERVAL_MS
    );
    this.network_clean_interval_ms = this.network_size * this.network_ping_interval_ms * 2;

    this.network_sync_threshold = Config.gte1(
      c.network_sync_threshold || process.env.NETWORK_SYNC_THRESHOLD,
      DEFAULT_NETWORK_SYNC_THRESHOLD
    );
    this.network_sync_size = Config.gte1(
      c.network_sync_size || process.env.NETWORK_SYNC_SIZE,
      DEFAULT_NETWORK_SYNC_SIZE
    );

    this.network_verbose_logging = Config.tf(c.network_verbose_logging || process.env.NETWORK_VERBOSE_LOGGING);

    this.block_pool_check_interval_ms = Config.gte1(
      c.block_pool_check_interval_ms || process.env.BLOCK_POOL_CHECK_INTERVAL_MS,
      DEFAULT_BLOCK_POOL_CHECK_INTERVAL_MS
    );
  }

  private static tf(n: any): boolean {
    return Number(n) > 0;
  }

  private static gte1(n: any, d: number = 1): number {
    n = Number(n);
    d = d > 1 ? d : 1;
    return n > 0 ? Math.ceil(n) : Math.floor(d);
  }

  private static b(n: any, min: number = 0, max: number = 65535): number {
    n = Number(n);
    min = Math.floor(min);
    max = Math.ceil(max);
    return n >= min && n <= max ? Math.floor(n) : n > min ? max : min;
  }

  private static port(n: any): number {
    return Config.b(Number(n), 1025, 65535);
  }
}
