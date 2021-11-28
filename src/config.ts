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
import { createLocalDestination } from '@diva.exchange/i2p-sam/dist/i2p-sam';
import net from 'net';

export type Configuration = {
  no_bootstrapping?: number;
  bootstrap?: string;

  path_app?: string;
  ip?: string;
  port?: number;
  port_block_feed?: number;
  path_genesis?: string;
  path_blockstore?: string;
  path_state?: string;
  path_keys?: string;

  i2p_socks_host?: string;
  i2p_socks_port?: number;
  i2p_sam_host?: string;
  i2p_sam_port_tcp?: number;
  i2p_sam_port_udp?: number;
  i2p_sam_listen_address?: string;
  i2p_sam_listen_port?: number;
  i2p_sam_listen_forward_host?: string;
  i2p_sam_listen_forward_port?: number;
  i2p_b32_address?: string;
  i2p_public_key?: string;
  i2p_private_key?: string;

  address?: string;

  network_size?: number;
  network_morph_interval_ms?: number;
  network_p2p_interval_ms?: number;
  network_auth_timeout_ms?: number;
  network_clean_interval_ms?: number;
  network_ping_interval_ms?: number;
  network_stale_threshold?: number;
  network_sync_size?: number;
  network_verbose_logging?: boolean;

  blockchain_max_blocks_in_memory?: number;

  api_max_query_size?: number;
};

export const BLOCK_VERSION = 3;

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_PORT_BLOCK_FEED = 17469;

const DEFAULT_I2P_SOCKS_PORT = 4445;
const DEFAULT_I2P_SAM_PORT_TCP = 7656;
const DEFAULT_I2P_SAM_PORT_UDP = 7655;

export const DEFAULT_NAME_GENESIS_BLOCK = 'block.v' + BLOCK_VERSION;
//@TODO review
export const PBFT_RETRY_INTERVAL_MS = 1000;

const MIN_NETWORK_SIZE = 7;
const MAX_NETWORK_SIZE = 64;
const MIN_NETWORK_MORPH_INTERVAL_MS = 300000;
const MAX_NETWORK_MORPH_INTERVAL_MS = 600000;
const MIN_NETWORK_P2P_INTERVAL_MS = 3000;
const MAX_NETWORK_P2P_INTERVAL_MS = 10000;
const MIN_NETWORK_AUTH_TIMEOUT_MS = 30000;
const MAX_NETWORK_AUTH_TIMEOUT_MS = 60000;
export const MIN_NETWORK_PING_INTERVAL_MS = 5000;
export const MAX_NETWORK_PING_INTERVAL_MS = 10000;
const MIN_NETWORK_CLEAN_INTERVAL_MS = 10000;
const MAX_NETWORK_CLEAN_INTERVAL_MS = 30000;
const MIN_NETWORK_STALE_THRESHOLD = 2;
const MAX_NETWORK_STALE_THRESHOLD = 5;
const MIN_NETWORK_SYNC_SIZE = 10;
const MAX_NETWORK_SYNC_SIZE = 100;

const MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 100;
const MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY = 1000;

const MIN_API_MAX_QUERY_SIZE = 10;
const MAX_API_MAX_QUERY_SIZE = 100;

export class Config {
  public debug_performance: boolean = false;
  public bootstrap: string = '';
  public path_app: string = '';
  public VERSION: string = '';
  public ip: string = '';
  public port: number = 0;
  public port_block_feed: number = 0;
  public path_genesis: string = '';
  public path_blockstore: string = '';
  public path_state: string = '';
  public path_keys: string = '';
  public i2p_socks_host: string = '';
  public i2p_socks_port: number = 0;
  public i2p_has_socks: boolean = false;
  public i2p_sam_host: string = '';
  public i2p_sam_port_tcp: number = 0;
  public i2p_sam_port_udp: number = 0;
  public i2p_sam_listen_address: string = '';
  public i2p_sam_listen_port: number = 0;
  public i2p_sam_listen_forward_host: string = '';
  public i2p_sam_listen_forward_port: number = 0;
  public i2p_has_sam: boolean = false;
  public i2p_b32_address: string = '';
  public i2p_public_key: string = '';
  public i2p_private_key: string = '';
  public address: string = '';
  public network_size: number = MIN_NETWORK_SIZE;
  public network_morph_interval_ms: number = MIN_NETWORK_MORPH_INTERVAL_MS;
  public network_p2p_interval_ms: number = MIN_NETWORK_P2P_INTERVAL_MS;
  public network_auth_timeout_ms: number = MIN_NETWORK_AUTH_TIMEOUT_MS;
  public network_clean_interval_ms: number = MIN_NETWORK_CLEAN_INTERVAL_MS;
  public network_ping_interval_ms: number = MIN_NETWORK_PING_INTERVAL_MS;
  public network_stale_threshold: number = MIN_NETWORK_STALE_THRESHOLD;
  public network_sync_size: number = MIN_NETWORK_SYNC_SIZE;
  public network_verbose_logging: boolean = false;

  public blockchain_max_blocks_in_memory: number = MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY;

  public api_max_query_size: number = MAX_API_MAX_QUERY_SIZE;

  static async make(c: Configuration): Promise<Config> {
    const self = new Config();
    self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);

    self.bootstrap =
      (c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';

    if (!c.path_app || !fs.existsSync(c.path_app)) {
      self.path_app = path.join(__dirname, '/../');
    } else {
      self.path_app = c.path_app;
    }

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
    self.port_block_feed = Config.port(c.port_block_feed || process.env.PORT_BLOCK_FEED || DEFAULT_PORT_BLOCK_FEED);

    const nameBlockGenesis = process.env.NAME_BLOCK_GENESIS
      ? process.env.NAME_BLOCK_GENESIS.replace(/[^a-z0-9._-]|^[._-]+|[._-]+$/gi, '')
      : DEFAULT_NAME_GENESIS_BLOCK;
    if (!c.path_genesis || !fs.existsSync(c.path_genesis)) {
      self.path_genesis = path.join(self.path_app, 'genesis/');
    } else {
      self.path_genesis = c.path_genesis;
    }
    if (!/\.json$/.test(self.path_genesis)) {
      self.path_genesis = self.path_genesis + nameBlockGenesis + '.json';
    }
    if (!fs.existsSync(self.path_genesis)) {
      throw new Error(`Path to genesis block not found: ${self.path_genesis}`);
    }

    if (!c.path_blockstore || !fs.existsSync(c.path_blockstore)) {
      self.path_blockstore = path.join(self.path_app, 'blockstore/');
    } else {
      self.path_blockstore = c.path_blockstore;
    }

    if (!c.path_state || !fs.existsSync(c.path_state)) {
      self.path_state = path.join(self.path_app, 'state/');
    } else {
      self.path_state = c.path_state;
    }

    if (!c.path_keys || !fs.existsSync(c.path_keys)) {
      self.path_keys = path.join(self.path_app, 'keys/');
    } else {
      self.path_keys = c.path_keys;
    }

    self.i2p_socks_host = c.i2p_socks_host || process.env.I2P_SOCKS_HOST || '';
    self.i2p_socks_port = Config.port(c.i2p_socks_port || process.env.I2P_SOCKS_PORT) || DEFAULT_I2P_SOCKS_PORT;
    self.i2p_has_socks =
      !!self.i2p_socks_host &&
      self.i2p_socks_port > 0 &&
      (await Config.isTCPAvailable(self.i2p_socks_host, self.i2p_socks_port));
    self.i2p_has_socks || (self.i2p_socks_host = '');

    self.i2p_sam_host = c.i2p_sam_host || process.env.I2P_SAM_HOST || '';
    self.i2p_sam_port_tcp = Config.port(c.i2p_sam_port_tcp || process.env.I2P_SAM_PORT_TCP) || DEFAULT_I2P_SAM_PORT_TCP;
    self.i2p_sam_port_udp = Config.port(c.i2p_sam_port_udp || process.env.I2P_SAM_PORT_UDP) || DEFAULT_I2P_SAM_PORT_UDP;
    self.i2p_sam_listen_address = c.i2p_sam_listen_address || process.env.I2P_SAM_LISTEN_ADDRESS || '';
    self.i2p_sam_listen_port = Config.port(c.i2p_sam_listen_port || process.env.I2P_SAM_LISTEN_PORT) || 0;
    self.i2p_sam_listen_forward_host = c.i2p_sam_listen_forward_host || process.env.I2P_SAM_LISTEN_FORWARD_HOST || '';
    self.i2p_sam_listen_forward_port =
      Config.port(c.i2p_sam_listen_forward_port || process.env.I2P_SAM_LISTEN_FORWARD_PORT) || self.i2p_sam_listen_port;

    self.i2p_has_sam =
      !!self.i2p_sam_host &&
      self.i2p_sam_port_tcp > 0 &&
      (await Config.isTCPAvailable(self.i2p_sam_host, self.i2p_sam_port_tcp));
    self.i2p_has_sam || (self.i2p_sam_host = '');

    self.address = c.address || process.env.ADDRESS || '';
    if (self.i2p_has_sam) {
      const pathDestination = path.join(self.path_keys, self.address);
      if (!self.address) {
        const obj = await createLocalDestination({
          sam: {
            host: self.i2p_sam_host,
            portTCP: self.i2p_sam_port_tcp,
          },
        });
        self.i2p_private_key = obj.private;
        self.i2p_public_key = obj.public;
        self.i2p_b32_address = obj.address;
        self.address = self.i2p_b32_address;
        fs.writeFileSync(path.join(self.path_keys, self.address) + '.public', self.i2p_public_key);
        fs.writeFileSync(path.join(self.path_keys, self.address) + '.private', self.i2p_private_key);
      } else if (/\.b32\.i2p$/.test(self.address) && fs.existsSync(pathDestination)) {
        self.i2p_b32_address = self.address;
        self.i2p_public_key = fs.readFileSync(pathDestination + '.public').toString();
        self.i2p_private_key = fs.readFileSync(pathDestination + '.private').toString();
      } else {
        throw new Error(`Fatal: invalid I2P address (${self.address})`);
      }
    } else if (!self.address || /\.b32\.i2p$/.test(self.address)) {
      throw new Error(`Fatal: invalid address (${self.address})`);
    }

    self.network_size = Config.b(c.network_size || process.env.NETWORK_SIZE, MIN_NETWORK_SIZE, MAX_NETWORK_SIZE);
    self.network_morph_interval_ms = Config.b(
      c.network_morph_interval_ms || process.env.NETWORK_MORPH_INTERVAL_MS,
      MIN_NETWORK_MORPH_INTERVAL_MS,
      MAX_NETWORK_MORPH_INTERVAL_MS
    );

    self.network_p2p_interval_ms = Config.b(
      c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS,
      MIN_NETWORK_P2P_INTERVAL_MS,
      MAX_NETWORK_P2P_INTERVAL_MS
    );
    self.network_auth_timeout_ms = Config.b(
      c.network_auth_timeout_ms || process.env.NETWORK_AUTH_TIMEOUT_MS,
      MIN_NETWORK_AUTH_TIMEOUT_MS,
      MAX_NETWORK_AUTH_TIMEOUT_MS
    );
    self.network_ping_interval_ms = Config.b(
      c.network_ping_interval_ms || process.env.NETWORK_PING_INTERVAL_MS,
      MIN_NETWORK_PING_INTERVAL_MS,
      MAX_NETWORK_PING_INTERVAL_MS
    );
    self.network_clean_interval_ms = Config.b(
      c.network_clean_interval_ms || process.env.NETWORK_CLEAN_INTERVAL_MS,
      MIN_NETWORK_CLEAN_INTERVAL_MS,
      MAX_NETWORK_CLEAN_INTERVAL_MS
    );

    self.network_stale_threshold = Config.b(
      c.network_stale_threshold || process.env.NETWORK_STALE_THRESHOLD,
      MIN_NETWORK_STALE_THRESHOLD,
      MAX_NETWORK_STALE_THRESHOLD
    );
    self.network_sync_size = Config.b(
      c.network_sync_size || process.env.NETWORK_SYNC_SIZE,
      MIN_NETWORK_SYNC_SIZE,
      MAX_NETWORK_SYNC_SIZE
    );

    self.network_verbose_logging = Config.tf(c.network_verbose_logging || process.env.NETWORK_VERBOSE_LOGGING);

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

  private static async isTCPAvailable(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tcp = new net.Socket();
      tcp.on('error', () => {
        resolve(false);
      });
      tcp.connect(port, host, () => {
        tcp.destroy();
        resolve(true);
      });
    });
  }
}
