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
import fs from 'fs';

export type Configuration = {
  no_bootstrapping?: number;
  bootstrap?: string;

  path_app?: string;
  ip?: string;
  port?: number;
  port_block_feed?: number;
  address?: string;
  path_genesis?: string;
  path_blockstore?: string;
  path_state?: string;
  path_keys?: string;

  i2p_socks_proxy_host?: string;
  i2p_socks_proxy_port?: number;
  i2p_socks_proxy_console_port?: number;

  pbft_lock_ms?: number;
  pbft_retry_ms?: number;
  pbft_deadlock_ms?: number;

  network_size?: number;
  network_morph_interval_ms?: number;
  network_refresh_interval_ms?: number;
  network_auth_timeout_ms?: number;
  network_clean_interval_ms?: number;
  network_ping_interval_ms?: number;
  network_stale_threshold?: number;
  network_sync_size?: number;
  network_verbose_logging?: boolean;

  blockchain_max_blocks_in_memory?: number;

  api_max_query_size?: number;
};

export const BLOCK_VERSION = 1;

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_PORT_BLOCK_FEED = 17469;
const DEFAULT_NAME_GENESIS_BLOCK = 'block';

const MIN_PBFT_LOCK_MS = 50;
const MAX_PBFT_LOCK_MS = 2000;
const MIN_PBFT_RETRY_MS = 200;
const MAX_PBFT_RETRY_MS = 2000;
const MIN_PBFT_DEADLOCK_MS = 3000;
const MAX_PBFT_DEADLOCK_MS = 10000;

const MIN_NETWORK_SIZE = 7;
const MAX_NETWORK_SIZE = 64;
const MIN_NETWORK_MORPH_INTERVAL_MS = 60000;
const MAX_NETWORK_MORPH_INTERVAL_MS = 600000;
const MIN_NETWORK_REFRESH_INTERVAL_MS = 3000;
const MAX_NETWORK_REFRESH_INTERVAL_MS = 10000;
const MIN_NETWORK_AUTH_TIMEOUT_MS = 30000;
const MAX_NETWORK_AUTH_TIMEOUT_MS = 60000;
const MIN_NETWORK_PING_INTERVAL_MS = 2000;
const MAX_NETWORK_PING_INTERVAL_MS = 10000;
const MIN_NETWORK_CLEAN_INTERVAL_MS = 10000;
const MAX_NETWORK_CLEAN_INTERVAL_MS = 30000;
const MIN_NETWORK_STALE_THRESHOLD = 2;
const MAX_NETWORK_STALE_THRESHOLD = 5;
const MIN_NETWORK_SYNC_SIZE = 10;
const MAX_NETWORK_SYNC_SIZE = 100;

const MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 500;
const MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 5000;

const MIN_API_MAX_QUERY_SIZE = 10;
const MAX_API_MAX_QUERY_SIZE = 100;

export class Config {
  public readonly debug_performance: boolean;

  public readonly bootstrap: string;

  public readonly path_app: string;
  public readonly VERSION: string;

  public readonly ip: string;
  public readonly port: number;
  public readonly port_block_feed: number;
  public address: string;
  public readonly path_genesis: string;
  public readonly path_blockstore: string;
  public readonly path_state: string;
  public readonly path_keys: string;
  public readonly i2p_socks_proxy_host: string;
  public readonly i2p_socks_proxy_port: number;
  public readonly i2p_socks_proxy_console_port: number;
  public readonly network_size: number;
  public readonly network_morph_interval_ms: number;
  public readonly network_refresh_interval_ms: number;
  public readonly network_auth_timeout_ms: number;
  public readonly network_clean_interval_ms: number;
  public readonly network_ping_interval_ms: number;
  public readonly network_stale_threshold: number;
  public readonly network_sync_size: number;
  public readonly network_verbose_logging: boolean;

  public readonly pbft_lock_ms: number;
  public readonly pbft_retry_ms: number;
  public readonly pbft_deadlock_ms: number;

  public readonly blockchain_max_blocks_in_memory: number;

  public readonly api_max_query_size: number;

  constructor(c: Configuration) {
    this.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);

    const nameBlockGenesis = (process.env.NAME_BLOCK_GENESIS || DEFAULT_NAME_GENESIS_BLOCK).replace(
      /[^a-z0-9._-]|^[._-]+|[._-]+$/gi,
      ''
    );

    this.bootstrap =
      (c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';

    this.path_app = c.path_app || path.join(__dirname, '/../');

    try {
      this.VERSION = fs.readFileSync(path.join(__dirname, 'version')).toString();
    } catch (error) {
      if (!fs.existsSync(path.join(this.path_app, 'package.json'))) {
        throw new Error('File not found: ' + path.join(this.path_app, 'package.json'));
      }
      this.VERSION = require(path.join(this.path_app, 'package.json')).version;
    }

    this.ip = c.ip || process.env.IP || DEFAULT_IP;
    this.port = Config.port(c.port || process.env.PORT || DEFAULT_PORT);
    this.port_block_feed = Config.port(c.port_block_feed || process.env.PORT_BLOCK_FEED || DEFAULT_PORT_BLOCK_FEED);
    this.address = c.address || process.env.ADDRESS || this.ip + ':' + this.port;

    this.path_genesis = c.path_genesis || path.join(this.path_app, 'genesis/');
    if (!fs.existsSync(this.path_genesis) && !/\.json$/.test(this.path_genesis)) {
      try {
        fs.mkdirSync(this.path_genesis, { mode: '755', recursive: true });
      } catch (error) {
        this.path_genesis = path.join(process.cwd(), 'genesis/');
        fs.mkdirSync(this.path_genesis, { mode: '755', recursive: true });
      }
      this.path_genesis = this.path_genesis + nameBlockGenesis + '.json';
    }
    if (!fs.existsSync(this.path_genesis)) {
      throw new Error(`Path to genesis block not found: ${this.path_genesis}`);
    }

    this.path_blockstore = c.path_blockstore || path.join(this.path_app, 'blockstore/');
    if (!fs.existsSync(this.path_blockstore)) {
      try {
        fs.mkdirSync(this.path_blockstore, { mode: '755', recursive: true });
      } catch (error) {
        this.path_blockstore = path.join(process.cwd(), 'blockstore/');
        fs.mkdirSync(this.path_blockstore, { mode: '755', recursive: true });
      }
    }

    this.path_state = c.path_state || path.join(this.path_app, 'state/');
    if (!fs.existsSync(this.path_state)) {
      try {
        fs.mkdirSync(this.path_state, { mode: '755', recursive: true });
      } catch (error) {
        this.path_state = path.join(process.cwd(), 'state/');
        fs.mkdirSync(this.path_state, { mode: '755', recursive: true });
      }
    }

    this.path_keys = c.path_keys || path.join(this.path_app, 'keys/');
    if (!fs.existsSync(this.path_keys)) {
      try {
        fs.mkdirSync(this.path_keys, { mode: '755', recursive: true });
      } catch (error) {
        this.path_keys = path.join(process.cwd(), 'keys/');
        fs.mkdirSync(this.path_keys, { mode: '755', recursive: true });
      }
    }

    this.i2p_socks_proxy_host = c.i2p_socks_proxy_host || process.env.I2P_SOCKS_PROXY_HOST || '';
    this.i2p_socks_proxy_port = Config.port(c.i2p_socks_proxy_port || process.env.I2P_SOCKS_PROXY_PORT);
    this.i2p_socks_proxy_console_port = Config.port(
      c.i2p_socks_proxy_console_port || process.env.I2P_SOCKS_PROXY_CONSOLE_PORT
    );

    this.network_size = Config.b(c.network_size || process.env.NETWORK_SIZE, MIN_NETWORK_SIZE, MAX_NETWORK_SIZE);
    this.network_morph_interval_ms = Config.b(
      c.network_morph_interval_ms || process.env.NETWORK_MORPH_INTERVAL_MS,
      MIN_NETWORK_MORPH_INTERVAL_MS,
      MAX_NETWORK_MORPH_INTERVAL_MS
    );

    this.network_refresh_interval_ms = Config.b(
      c.network_refresh_interval_ms || process.env.NETWORK_REFRESH_INTERVAL_MS,
      MIN_NETWORK_REFRESH_INTERVAL_MS,
      MAX_NETWORK_REFRESH_INTERVAL_MS
    );
    this.network_auth_timeout_ms = Config.b(
      c.network_auth_timeout_ms || process.env.NETWORK_AUTH_TIMEOUT_MS,
      MIN_NETWORK_AUTH_TIMEOUT_MS,
      MAX_NETWORK_AUTH_TIMEOUT_MS
    );
    this.network_ping_interval_ms = Config.b(
      c.network_ping_interval_ms || process.env.NETWORK_PING_INTERVAL_MS,
      MIN_NETWORK_PING_INTERVAL_MS,
      MAX_NETWORK_PING_INTERVAL_MS
    );
    this.network_clean_interval_ms = Config.b(
      c.network_clean_interval_ms || process.env.NETWORK_CLEAN_INTERVAL_MS,
      MIN_NETWORK_CLEAN_INTERVAL_MS,
      MAX_NETWORK_CLEAN_INTERVAL_MS
    );

    this.network_stale_threshold = Config.b(
      c.network_stale_threshold || process.env.NETWORK_STALE_THRESHOLD,
      MIN_NETWORK_STALE_THRESHOLD,
      MAX_NETWORK_STALE_THRESHOLD
    );
    this.network_sync_size = Config.b(
      c.network_sync_size || process.env.NETWORK_SYNC_SIZE,
      MIN_NETWORK_SYNC_SIZE,
      MAX_NETWORK_SYNC_SIZE
    );

    this.network_verbose_logging = Config.tf(c.network_verbose_logging || process.env.NETWORK_VERBOSE_LOGGING);

    this.pbft_lock_ms = Config.b(c.pbft_lock_ms || process.env.PBFT_LOCK_MS, MIN_PBFT_LOCK_MS, MAX_PBFT_LOCK_MS);
    this.pbft_retry_ms = Config.b(c.pbft_retry_ms || process.env.PBFT_RETRY_MS, MIN_PBFT_RETRY_MS, MAX_PBFT_RETRY_MS);
    this.pbft_deadlock_ms = Config.b(
      c.pbft_deadlock_ms || process.env.PBFT_DEADLOCK_MS,
      MIN_PBFT_DEADLOCK_MS,
      MAX_PBFT_DEADLOCK_MS
    );

    this.blockchain_max_blocks_in_memory = Config.b(
      c.blockchain_max_blocks_in_memory ||
        process.env.BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY ||
        MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY,
      MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY,
      MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY
    );
    this.api_max_query_size = Config.b(
      c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE,
      MIN_API_MAX_QUERY_SIZE,
      MAX_API_MAX_QUERY_SIZE
    );
  }

  /**
   * Boolean transformation
   * Returns True or False
   *
   * @param {any} n - Anything which will be interpreted as a number
   */
  private static tf(n: any): boolean {
    return Number(n) > 0;
  }

  /**
   * Number transformation
   * Boundaries
   *
   * @param {any} n - Anything transformed to a number
   * @param {number} min - Boundary minimum
   * @param {number} max - Boundary maximum
   */
  private static b(n: any, min: number, max: number): number {
    n = Number(n);
    min = Math.floor(min);
    max = Math.ceil(max);
    return n >= min && n <= max ? Math.floor(n) : n > max ? max : min;
  }

  private static port(n: any): number {
    return Number(n) ? Config.b(Number(n), 1025, 65535) : 0;
  }
}
