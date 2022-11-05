/**
 * Copyright (C) 2021-2022 diva.exchange
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

import path from 'path';
import fs from 'fs';
import { createLocalDestination, toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import { Genesis } from './genesis';

export type Configuration = {
  no_bootstrapping?: number;
  bootstrap?: string;

  ip?: string;
  port?: number;
  port_block_feed?: number;

  path_app?: string;
  path_genesis?: string;
  path_blockstore?: string;
  path_state?: string;
  path_keys?: string;

  i2p_socks_host?: string;
  i2p_socks_port?: number;

  i2p_sam_http_host?: string;
  i2p_sam_http_port_tcp?: number;
  i2p_sam_udp_host?: string;
  i2p_sam_udp_port_tcp?: number;
  i2p_sam_udp_port_udp?: number;
  i2p_sam_forward_http_host?: string;
  i2p_sam_forward_http_port?: number;
  i2p_sam_listen_udp_host?: string;
  i2p_sam_listen_udp_port?: number;
  i2p_sam_forward_udp_host?: string;
  i2p_sam_forward_udp_port?: number;
  i2p_public_key_http?: string;
  i2p_private_key_http?: string;
  i2p_public_key_udp?: string;
  i2p_private_key_udp?: string;

  http?: string;
  udp?: string;

  network_timeout_ms?: number;
  network_p2p_interval_ms?: number;
  network_sync_size?: number;

  block_retry_timeout_ms?: number;

  blockchain_max_blocks_in_memory?: number;

  api_max_query_size?: number;
};

export const BLOCK_VERSION = 7;
export const DEFAULT_NAME_GENESIS_BLOCK = 'block.v' + BLOCK_VERSION;
export const MAX_NETWORK_SIZE = 16;
export const STAKE_PING_IDENT = 'ping';
export const STAKE_PING_AMOUNT = 1;
export const STAKE_PING_SAMPLE_SIZE = 32;
export const STAKE_PING_QUARTILE_COEFF_MIN = 0.4;
export const STAKE_PING_QUARTILE_COEFF_MAX = 0.6;
export const STAKE_VOTE_IDENT = 'vote';
export const STAKE_VOTE_MATCH_THRESHOLD = 3;
export const STAKE_VOTE_AMOUNT = 1;

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_BLOCK_FEED_PORT = DEFAULT_PORT + 1;

const DEFAULT_I2P_SOCKS_PORT = 4445;

const DEFAULT_I2P_SAM_TCP_PORT = 7656;
const DEFAULT_I2P_SAM_UDP_PORT = 7655;
const DEFAULT_I2P_SAM_FORWARD_HTTP_PORT = DEFAULT_PORT;
const DEFAULT_I2P_SAM_LISTEN_UDP_PORT = DEFAULT_PORT + 2;
const DEFAULT_I2P_SAM_FORWARD_UDP_PORT = DEFAULT_I2P_SAM_LISTEN_UDP_PORT;

const DEFAULT_NETWORK_TIMEOUT_MS = 10000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const MIN_NETWORK_P2P_INTERVAL_MS = 10000;
const MAX_NETWORK_P2P_INTERVAL_MS = 30000;
const MIN_NETWORK_SYNC_SIZE = 10;
const MAX_NETWORK_SYNC_SIZE = 100;

const MIN_BLOCK_RETRY_TIMEOUT_MS = 1000;
const MAX_BLOCK_RETRY_TIMEOUT_MS = 10000;

const MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 100;
const MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 1000;

const MIN_API_MAX_QUERY_SIZE = 10;
const MAX_API_MAX_QUERY_SIZE = 100;

export class Config {
  public debug_performance: boolean = false;
  public bootstrap: string = '';
  public VERSION: string = '';

  public ip: string = '';
  public port: number = 0;
  public port_block_feed: number = 0;

  public path_app: string = '';
  public path_genesis: string = '';
  public path_blockstore: string = '';
  public path_state: string = '';
  public path_keys: string = '';

  public http: string = '';
  public udp: string = '';

  public i2p_socks_host: string = '';
  public i2p_socks_port: number = 0;
  public i2p_sam_http_host: string = '';
  public i2p_sam_http_port_tcp: number = 0;
  public i2p_sam_udp_host: string = '';
  public i2p_sam_udp_port_tcp: number = 0;
  public i2p_sam_udp_port_udp: number = 0;
  public i2p_sam_forward_http_host: string = '';
  public i2p_sam_forward_http_port: number = 0;
  public i2p_sam_listen_udp_host: string = '';
  public i2p_sam_listen_udp_port: number = 0;
  public i2p_sam_forward_udp_host: string = '';
  public i2p_sam_forward_udp_port: number = 0;
  public i2p_public_key_http: string = '';
  public i2p_private_key_http: string = '';
  public i2p_public_key_udp: string = '';
  public i2p_private_key_udp: string = '';

  public network_timeout_ms: number = 0;
  public network_p2p_interval_ms: number = 0;
  public network_sync_size: number = 0;

  public block_retry_timeout_ms: number = 0;

  public blockchain_max_blocks_in_memory: number = 0;

  public api_max_query_size: number = 0;

  static async make(c: Configuration): Promise<Config> {
    const self = new Config();

    // GENESIS mode
    if (process.env.GENESIS === '1') {
      const obj: { genesis: any; config: Array<any> } = await Genesis.create();
      const _p = process.env.GENESIS_PATH || '';
      if (_p && fs.existsSync(path.dirname(_p)) && /\.json$/.test(_p)) {
        fs.writeFileSync(_p, JSON.stringify(obj.genesis), { mode: '0644' });
        const _c = process.env.GENESIS_CONFIG_PATH || '';
        if (_c && fs.existsSync(path.dirname(_c)) && /\.config$/.test(_c)) {
          fs.writeFileSync(
            _c,
            JSON.stringify(
              obj.config.map((cnf: Array<any>) => {
                return { http: cnf[1].http, udp: cnf[1].udp };
              })
            ),
            { mode: '0644' }
          );
        }
      } else {
        process.stdout.write(JSON.stringify(obj.genesis));
      }

      process.exit(0);
    }

    // setting the path, if the executable is a packaged binary (see "pkg --help")
    if (Object.keys(process).includes('pkg')) {
      c.path_app = path.dirname(process.execPath);
    }

    if (!c.path_app || !fs.existsSync(c.path_app)) {
      self.path_app = path.join(__dirname, '/../');
    } else {
      self.path_app = c.path_app;
    }

    self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);

    self.bootstrap =
      (c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';

    try {
      self.VERSION = fs.readFileSync(path.join(__dirname, 'version')).toString();
    } catch (error) {
      if (!fs.existsSync(path.join(self.path_app, 'package.json'))) {
        throw new Error('File not found: ' + path.join(self.path_app, 'package.json'));
      }
      self.VERSION = require(path.join(self.path_app, 'package.json')).version;
    }

    self.ip = c.ip || process.env.IP || DEFAULT_IP;
    self.port = Config.port(c.port || process.env.PORT || DEFAULT_PORT);
    self.port_block_feed = Config.port(c.port_block_feed || process.env.BLOCK_FEED_PORT || DEFAULT_BLOCK_FEED_PORT);

    if (!c.path_keys || !fs.existsSync(c.path_keys)) {
      self.path_keys = path.join(self.path_app, 'keys/');
    } else {
      self.path_keys = c.path_keys;
    }
    if (!fs.existsSync(self.path_keys)) {
      throw new Error(`Path to the keys storage not found: ${self.path_keys}`);
    }

    self.http = c.http || process.env.HTTP || '';
    self.udp = c.udp || process.env.UDP || '';

    self.i2p_socks_host = c.i2p_socks_host || process.env.I2P_SOCKS_HOST || self.ip;
    self.i2p_socks_port = Config.port(c.i2p_socks_port || process.env.I2P_SOCKS_PORT) || DEFAULT_I2P_SOCKS_PORT;
    self.i2p_sam_http_host = c.i2p_sam_http_host || process.env.I2P_SAM_HTTP_HOST || self.ip;
    self.i2p_sam_http_port_tcp =
      Config.port(c.i2p_sam_http_port_tcp || process.env.I2P_SAM_HTTP_PORT_TCP) || DEFAULT_I2P_SAM_TCP_PORT;
    self.i2p_sam_udp_host = c.i2p_sam_udp_host || process.env.I2P_SAM_UDP_HOST || self.ip;
    self.i2p_sam_udp_port_tcp =
      Config.port(c.i2p_sam_udp_port_tcp || process.env.I2P_SAM_UDP_PORT_TCP) || DEFAULT_I2P_SAM_TCP_PORT;
    self.i2p_sam_udp_port_udp =
      Config.port(c.i2p_sam_udp_port_udp || process.env.I2P_SAM_UDP_PORT_UDP) || DEFAULT_I2P_SAM_UDP_PORT;
    self.i2p_sam_forward_http_host = c.i2p_sam_forward_http_host || process.env.I2P_SAM_FORWARD_HTTP_HOST || self.ip;
    self.i2p_sam_forward_http_port =
      Config.port(c.i2p_sam_forward_http_port || process.env.I2P_SAM_FORWARD_HTTP_PORT) ||
      DEFAULT_I2P_SAM_FORWARD_HTTP_PORT;
    self.i2p_sam_listen_udp_host = c.i2p_sam_listen_udp_host || process.env.I2P_SAM_LISTEN_UDP_HOST || self.ip;
    self.i2p_sam_listen_udp_port =
      Config.port(c.i2p_sam_listen_udp_port || process.env.I2P_SAM_LISTEN_UDP_PORT) || DEFAULT_I2P_SAM_LISTEN_UDP_PORT;
    self.i2p_sam_forward_udp_host = c.i2p_sam_forward_udp_host || process.env.I2P_SAM_FORWARD_UDP_HOST || self.ip;
    self.i2p_sam_forward_udp_port =
      Config.port(c.i2p_sam_forward_udp_port || process.env.I2P_SAM_FORWARD_UDP_PORT) ||
      DEFAULT_I2P_SAM_FORWARD_UDP_PORT;

    if (self.http.length > 0) {
      const _b32 = /\.b32\.i2p$/.test(self.http) ? self.http : toB32(self.http) + '.b32.i2p';
      const _p = path.join(self.path_keys, _b32);
      self.i2p_public_key_http = fs.readFileSync(_p + '.public').toString();
      self.i2p_private_key_http = fs.readFileSync(_p + '.private').toString();
    } else {
      const obj = await Config.createI2PDestination(self);
      self.i2p_public_key_http = obj.public;
      self.i2p_private_key_http = obj.private;
    }
    self.http = self.i2p_public_key_http;

    if (self.udp.length > 0) {
      const _b32 = /\.b32\.i2p$/.test(self.udp) ? self.udp : toB32(self.udp) + '.b32.i2p';
      const _p = path.join(self.path_keys, _b32);
      self.i2p_public_key_udp = fs.readFileSync(_p + '.public').toString();
      self.i2p_private_key_udp = fs.readFileSync(_p + '.private').toString();
    } else {
      const obj = await Config.createI2PDestination(self);
      self.i2p_public_key_udp = obj.public;
      self.i2p_private_key_udp = obj.private;
    }
    self.udp = self.i2p_public_key_udp;

    if (!c.path_genesis || !fs.existsSync(c.path_genesis)) {
      self.path_genesis = path.join(self.path_app, 'genesis/');
    } else {
      self.path_genesis = c.path_genesis;
    }
    if (!/\.json$/.test(self.path_genesis)) {
      self.path_genesis = self.path_genesis + DEFAULT_NAME_GENESIS_BLOCK + '.json';
    }
    if (!fs.existsSync(self.path_genesis)) {
      throw new Error(`Path to genesis block not found: ${self.path_genesis}`);
    }

    if (!c.path_blockstore || !fs.existsSync(c.path_blockstore)) {
      self.path_blockstore = path.join(self.path_app, 'blockstore/');
    } else {
      self.path_blockstore = c.path_blockstore;
    }
    if (!fs.existsSync(self.path_blockstore)) {
      throw new Error(`Path to the blockstore database not found: ${self.path_blockstore}`);
    }

    if (!c.path_state || !fs.existsSync(c.path_state)) {
      self.path_state = path.join(self.path_app, 'state/');
    } else {
      self.path_state = c.path_state;
    }
    if (!fs.existsSync(self.path_state)) {
      throw new Error(`Path to the state database not found: ${self.path_state}`);
    }

    self.network_timeout_ms = Config.b(
      c.network_timeout_ms || process.env.NETWORK_TIMEOUT_MS || DEFAULT_NETWORK_TIMEOUT_MS,
      MIN_NETWORK_TIMEOUT_MS,
      MAX_NETWORK_TIMEOUT_MS
    );

    self.network_p2p_interval_ms = Config.b(
      c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS,
      MIN_NETWORK_P2P_INTERVAL_MS,
      MAX_NETWORK_P2P_INTERVAL_MS
    );

    self.network_sync_size = Config.b(
      c.network_sync_size || process.env.NETWORK_SYNC_SIZE,
      MIN_NETWORK_SYNC_SIZE,
      MAX_NETWORK_SYNC_SIZE
    );

    self.block_retry_timeout_ms = Config.b(
      c.block_retry_timeout_ms || process.env.BLOCK_RETRY_TIMEOUT_MS,
      MIN_BLOCK_RETRY_TIMEOUT_MS,
      MAX_BLOCK_RETRY_TIMEOUT_MS
    );

    self.blockchain_max_blocks_in_memory = Config.b(
      c.blockchain_max_blocks_in_memory ||
        process.env.BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY ||
        MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY,
      MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY,
      MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY
    );
    self.api_max_query_size = Config.b(
      c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE,
      MIN_API_MAX_QUERY_SIZE,
      MAX_API_MAX_QUERY_SIZE
    );

    return self;
  }

  private constructor() {}

  private static async createI2PDestination(self: Config) {
    const obj = await createLocalDestination({
      sam: {
        host: self.i2p_sam_http_host,
        portTCP: self.i2p_sam_http_port_tcp,
      },
    });

    const pathDestination = path.join(self.path_keys, obj.address);
    if (fs.existsSync(pathDestination + '.public') || fs.existsSync(pathDestination + '.private')) {
      throw new Error(`Address already exists: ${pathDestination}`);
    }
    fs.writeFileSync(pathDestination + '.public', obj.public, { mode: '0644' });
    fs.writeFileSync(pathDestination + '.private', obj.private, { mode: '0600' });

    return obj;
  }

  private static tf(n: any): boolean {
    return Number(n) > 0;
  }

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
