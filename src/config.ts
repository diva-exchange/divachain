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
import { Util } from './chain/util';

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

  i2p_sam_http_host?: string;
  i2p_sam_http_port_tcp?: number;
  i2p_sam_udp_host?: string;
  i2p_sam_udp_port_tcp?: number;
  i2p_sam_udp_port_udp?: number;
  i2p_sam_forward_http_host?: string;
  i2p_sam_forward_http_port?: number;
  i2p_sam_forward_udp_host?: string;
  i2p_sam_forward_udp_port?: number;
  i2p_public_key_http?: string;
  i2p_private_key_http?: string;
  i2p_public_key_udp?: string;
  i2p_private_key_udp?: string;

  http?: string;
  udp?: string;

  network_p2p_interval_ms?: number;
  network_clean_interval_ms?: number;
  network_sync_size?: number;

  blockchain_max_blocks_in_memory?: number;

  api_max_query_size?: number;
};

export const BLOCK_VERSION = 3;
export const DEFAULT_NAME_GENESIS_BLOCK = 'block.v' + BLOCK_VERSION;

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_BLOCK_FEED_PORT = 17469;

const DEFAULT_I2P_SAM_PORT_TCP = 7656;
const DEFAULT_I2P_SAM_PORT_UDP = 7655;
const DEFAULT_I2P_SAM_FORWARD_HTTP_PORT = 17470;
const DEFAULT_I2P_SAM_FORWARD_PORT_UDP = 17471;

const MIN_NETWORK_P2P_INTERVAL_MS = 10000;
const MAX_NETWORK_P2P_INTERVAL_MS = 60000;
const MIN_NETWORK_CLEAN_INTERVAL_MS = 3000;
const MAX_NETWORK_CLEAN_INTERVAL_MS = 10000;
const MIN_NETWORK_SYNC_SIZE = 10;
const MAX_NETWORK_SYNC_SIZE = 100;

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

  public has_i2p: boolean = false;
  public i2p_sam_http_host: string = '';
  public i2p_sam_http_port_tcp: number = 0;
  public i2p_sam_udp_host: string = '';
  public i2p_sam_udp_port_tcp: number = 0;
  public i2p_sam_udp_port_udp: number = 0;
  public i2p_sam_forward_http_host: string = '';
  public i2p_sam_forward_http_port: number = 0;
  public i2p_sam_forward_udp_host: string = '';
  public i2p_sam_forward_udp_port: number = 0;
  public i2p_public_key_http: string = '';
  public i2p_private_key_http: string = '';
  public i2p_public_key_udp: string = '';
  public i2p_private_key_udp: string = '';

  public network_p2p_interval_ms: number = MIN_NETWORK_P2P_INTERVAL_MS;
  public network_clean_interval_ms: number = MIN_NETWORK_CLEAN_INTERVAL_MS;
  public network_sync_size: number = MIN_NETWORK_SYNC_SIZE;

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
    self.port_block_feed = Config.port(c.port_block_feed || process.env.BLOCK_FEED_PORT || DEFAULT_BLOCK_FEED_PORT);

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

    self.udp = c.udp || process.env.UDP || '';
    self.http = c.http || process.env.HTTP || '';

    self.i2p_sam_http_host = c.i2p_sam_http_host || process.env.I2P_SAM_HTTP_HOST || '';
    self.i2p_sam_http_port_tcp =
      Config.port(c.i2p_sam_http_port_tcp || process.env.I2P_SAM_HTTP_PORT_TCP) || DEFAULT_I2P_SAM_PORT_TCP;
    self.i2p_sam_udp_host = c.i2p_sam_udp_host || process.env.I2P_SAM_UDP_HOST || '';
    self.i2p_sam_udp_port_tcp =
      Config.port(c.i2p_sam_udp_port_tcp || process.env.I2P_SAM_UDP_PORT_TCP) || DEFAULT_I2P_SAM_PORT_TCP;
    self.i2p_sam_udp_port_udp =
      Config.port(c.i2p_sam_udp_port_udp || process.env.I2P_SAM_UDP_PORT_UDP) || DEFAULT_I2P_SAM_PORT_UDP;
    self.i2p_sam_forward_http_host = c.i2p_sam_forward_http_host || process.env.I2P_SAM_FORWARD_HTTP_HOST || '';
    self.i2p_sam_forward_http_port =
      Config.port(c.i2p_sam_forward_http_port || process.env.I2P_SAM_FORWARD_HTTP_PORT) ||
      DEFAULT_I2P_SAM_FORWARD_HTTP_PORT;
    self.i2p_sam_forward_udp_host = c.i2p_sam_forward_udp_host || process.env.I2P_SAM_FORWARD_HOST_UDP || '';
    self.i2p_sam_forward_udp_port =
      Config.port(c.i2p_sam_forward_udp_port || process.env.I2P_SAM_FORWARD_PORT_UDP) ||
      DEFAULT_I2P_SAM_FORWARD_PORT_UDP;

    self.has_i2p =
      !!self.i2p_sam_http_host &&
      self.i2p_sam_http_port_tcp > 0 &&
      (await Config.isTCPAvailable(self.i2p_sam_http_host, self.i2p_sam_http_port_tcp)) &&
      !!self.i2p_sam_udp_host &&
      self.i2p_sam_udp_port_tcp > 0 &&
      (await Config.isTCPAvailable(self.i2p_sam_udp_host, self.i2p_sam_udp_port_tcp));

    if (self.has_i2p) {
      if (/\.b32\.i2p$/.test(self.http)) {
        const _p = path.join(self.path_keys, Util.hash(self.http));
        self.i2p_public_key_http = fs.readFileSync(_p + '.public').toString();
        self.i2p_private_key_http = fs.readFileSync(_p + '.private').toString();
      } else {
        const obj = await Config.createI2PDestination(self);
        self.i2p_public_key_http = obj.public;
        self.i2p_private_key_http = obj.private;
      }
      self.http = self.i2p_public_key_http;

      if (/\.b32\.i2p$/.test(self.udp)) {
        const _p = path.join(self.path_keys, Util.hash(self.udp));
        self.i2p_public_key_udp = fs.readFileSync(_p + '.public').toString();
        self.i2p_private_key_udp = fs.readFileSync(_p + '.private').toString();
      } else {
        const obj = await Config.createI2PDestination(self);
        self.i2p_public_key_udp = obj.public;
        self.i2p_private_key_udp = obj.private;
      }
      self.udp = self.i2p_public_key_udp;
    }

    if (!self.http || !self.udp) {
      throw new Error('Invalid network configuration');
    }

    self.network_p2p_interval_ms = Config.b(
      c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS,
      MIN_NETWORK_P2P_INTERVAL_MS,
      MAX_NETWORK_P2P_INTERVAL_MS
    );

    self.network_clean_interval_ms = Config.b(
      c.network_clean_interval_ms || process.env.NETWORK_CLEAN_INTERVAL_MS,
      MIN_NETWORK_CLEAN_INTERVAL_MS,
      MAX_NETWORK_CLEAN_INTERVAL_MS
    );
    self.network_sync_size = Config.b(
      c.network_sync_size || process.env.NETWORK_SYNC_SIZE,
      MIN_NETWORK_SYNC_SIZE,
      MAX_NETWORK_SYNC_SIZE
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

    const pathDestination = path.join(self.path_keys, Util.hash(obj.address));
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
