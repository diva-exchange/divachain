/**
 * Copyright (C) 2021-2024 diva.exchange
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
import { createLocalDestination, toB32 } from '@diva.exchange/i2p-sam';
import { Genesis } from './genesis.js';

export type Configuration = {
  no_bootstrapping?: number;
  bootstrap?: string;

  ip?: string;
  port?: number;
  port_tx_feed?: number;

  path_app?: string;
  path_genesis?: string;
  path_chain?: string;
  path_state?: string;
  path_keys?: string;

  i2p_socks?: string;

  i2p_sam_http?: string;
  i2p_sam_forward_http?: string;
  i2p_public_key_http?: string;
  i2p_private_key_http?: string;

  i2p_sam_tcp?: string;
  i2p_sam_listen_tcp?: string;
  i2p_sam_forward_tcp?: string;
  i2p_sam_tcp_client?: Array<string>;
  i2p_public_key_tcp?: string;
  i2p_private_key_tcp?: string;

  i2p_sam_udp?: string;
  i2p_sam_udp_port_udp?: number;
  i2p_sam_listen_udp?: string;
  i2p_sam_forward_udp?: string;
  i2p_public_key_udp?: string;
  i2p_private_key_udp?: string;

  i2p_sam_tunnel_var_min?: number;
  i2p_sam_tunnel_var_max?: number;

  http?: string;
  tcp?: string;
  udp?: string;

  network_has_tcp?: boolean;
  network_timeout_ms?: number;
  network_p2p_interval_ms?: number;
  network_sync_size?: number;

  chain_max_txs_in_memory?: number;

  api_max_query_size?: number;
};

export const TX_VERSION: number = 1;
export const DEFAULT_NAME_GENESIS: string = 'tx.v' + TX_VERSION;
export const MAX_NETWORK_SIZE: number = 24;

const DEFAULT_IP: string = '127.0.0.1';
const DEFAULT_PORT: number = 17468;
const DEFAULT_TX_FEED_PORT: number = DEFAULT_PORT + 1;

const DEFAULT_I2P_SOCKS_PORT: number = 4445;

const DEFAULT_I2P_SAM_FORWARD_HTTP_PORT: number = DEFAULT_PORT;

const DEFAULT_I2P_SAM_TCP_PORT: number = 7656;

const DEFAULT_I2P_SAM_UDP_PORT: number = 7656;
const DEFAULT_I2P_SAM_UDP_PORT_UDP: number = 7655;

const DEFAULT_I2P_SAM_LISTEN_UDP_PORT: number = DEFAULT_PORT + 2;
const DEFAULT_I2P_SAM_FORWARD_UDP_PORT: number = DEFAULT_I2P_SAM_LISTEN_UDP_PORT;

const DEFAULT_I2P_SAM_TUNNEL_VAR_MIN: number = 0;
const DEFAULT_I2P_SAM_TUNNEL_VAR_MAX: number = 2;

const DEFAULT_NETWORK_TIMEOUT_MS: number = 10000;
const MIN_NETWORK_TIMEOUT_MS: number = 1000;
const MAX_NETWORK_TIMEOUT_MS: number = 60000;
const MIN_NETWORK_P2P_INTERVAL_MS: number = 10000;
const MAX_NETWORK_P2P_INTERVAL_MS: number = 30000;
const MIN_NETWORK_SYNC_SIZE: number = 10;
const MAX_NETWORK_SYNC_SIZE: number = 100;

const MIN_CHAIN_MAX_TXS_IN_MEMORY: number = 100;
const MAX_CHAIN_MAX_TXS_IN_MEMORY: number = 1000;

const MIN_API_MAX_QUERY_SIZE: number = 10;
const MAX_API_MAX_QUERY_SIZE: number = 100;

export class Config {
  public is_testnet: boolean = true;
  public debug_performance: boolean = false;
  public bootstrap: string = '';
  public VERSION: string = '';

  public ip: string = '';
  public port: number = 0;
  public port_tx_feed: number = 0;

  public path_app: string = '';
  public path_genesis: string = '';
  public path_chain: string = '';
  public path_state: string = '';
  public path_keys: string = '';

  public i2p_socks: string = '';

  public i2p_sam_http: string = '';
  public i2p_sam_forward_http: string = '';
  public i2p_public_key_http: string = '';
  public i2p_private_key_http: string = '';
  public http: string = '';

  public i2p_sam_udp: string = '';
  public i2p_sam_udp_port_udp: number = 0; // specs 7655
  public i2p_sam_listen_udp: string = '';
  public i2p_sam_forward_udp: string = '';
  public i2p_public_key_udp: string = '';
  public i2p_private_key_udp: string = '';
  public udp: string = '';

  public i2p_sam_tunnel_var_min: number = 0;
  public i2p_sam_tunnel_var_max: number = 0;

  public network_timeout_ms: number = 0;
  public network_p2p_interval_ms: number = 0;
  public network_sync_size: number = 0;

  public chain_max_txs_in_memory: number = 0;

  public api_max_query_size: number = 0;

  static async make(c: Configuration): Promise<Config> {
    const ___dirname: string = path.dirname(import.meta.url.replace(/^file:\/\//, ''));
    const self: Config = new Config();

    // TESTNET mode
    self.is_testnet = (process.env.IS_TESTNET || false) === '1';

    // GENESIS mode
    if (process.env.GENESIS === '1') {
      const obj: { genesis: any; config: Array<any> } = await Genesis.create();
      const _p: string = process.env.GENESIS_PATH || '';
      if (_p && fs.existsSync(path.dirname(_p)) && /\.json$/.test(_p)) {
        fs.writeFileSync(_p, JSON.stringify(obj.genesis), { mode: '0644' });
        const _c: string = process.env.GENESIS_CONFIG_PATH || '';
        if (_c && fs.existsSync(path.dirname(_c)) && /\.config$/.test(_c)) {
          fs.writeFileSync(
            _c,
            JSON.stringify(
              obj.config.map((cnf: Array<any>): { http: string; udp: string } => {
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
      self.path_app = path.join(___dirname, '/../');
    } else {
      self.path_app = c.path_app;
    }

    self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);

    self.bootstrap =
      +(c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';

    try {
      self.VERSION = fs.readFileSync(path.join(___dirname, 'version')).toString();
    } catch (error) {
      if (!fs.existsSync(path.join(self.path_app, 'package.json'))) {
        throw new Error('File not found: ' + path.join(self.path_app, 'package.json'));
      }
      self.VERSION = (await import(path.join(self.path_app, 'package.json'))).version;
    }

    self.ip = c.ip || process.env.IP || DEFAULT_IP;
    self.port = Config.port(c.port || process.env.PORT || DEFAULT_PORT);
    self.port_tx_feed = Config.port(c.port_tx_feed || process.env.BLOCK_FEED_PORT || DEFAULT_TX_FEED_PORT);

    if (!c.path_keys || !fs.existsSync(c.path_keys)) {
      self.path_keys = path.join(self.path_app, 'keys/');
    } else {
      self.path_keys = c.path_keys;
    }
    if (!fs.existsSync(self.path_keys)) {
      throw new Error(`Path to the keys storage not found: ${self.path_keys}`);
    }

    self.http = c.http || process.env.HTTP || '';

    // SOCKS
    self.i2p_socks = c.i2p_socks || process.env.I2P_SOCKS || self.ip + ':' + DEFAULT_I2P_SOCKS_PORT;

    // HTTP
    self.i2p_sam_http = c.i2p_sam_http || process.env.I2P_SAM_HTTP || self.ip + ':' + DEFAULT_I2P_SAM_TCP_PORT;
    self.i2p_sam_forward_http =
      c.i2p_sam_forward_http || process.env.I2P_SAM_FORWARD_HTTP || self.ip + ':' + DEFAULT_I2P_SAM_FORWARD_HTTP_PORT;
    if (self.http.length > 0) {
      const _b32: string = /\.b32\.i2p$/.test(self.http) ? self.http : toB32(self.http) + '.b32.i2p';
      const _p: string = path.join(self.path_keys, _b32);
      self.i2p_public_key_http = fs.readFileSync(_p + '.public').toString();
      self.i2p_private_key_http = fs.readFileSync(_p + '.private').toString();
    } else {
      const obj = await Config.createI2PDestination(self);
      self.i2p_public_key_http = obj.public;
      self.i2p_private_key_http = obj.private;
    }
    self.http = self.i2p_public_key_http;

    // UDP
    self.i2p_sam_udp = c.i2p_sam_udp || process.env.I2P_SAM_UDP || self.ip + ':' + DEFAULT_I2P_SAM_UDP_PORT;
    self.i2p_sam_udp_port_udp =
      c.i2p_sam_udp_port_udp || Number(process.env.I2P_SAM_UDP_PORT_UDP) || DEFAULT_I2P_SAM_UDP_PORT_UDP;
    self.i2p_sam_listen_udp =
      c.i2p_sam_listen_udp || process.env.I2P_SAM_LISTEN_UDP || self.ip + ':' + DEFAULT_I2P_SAM_LISTEN_UDP_PORT;
    self.i2p_sam_forward_udp =
      c.i2p_sam_forward_udp || process.env.I2P_SAM_FORWARD_UDP || self.ip + ':' + DEFAULT_I2P_SAM_FORWARD_UDP_PORT;
    if (self.udp.length > 0) {
      const _b32: string = /\.b32\.i2p$/.test(self.udp) ? self.udp : toB32(self.udp) + '.b32.i2p';
      const _p: string = path.join(self.path_keys, _b32);
      self.i2p_public_key_udp = fs.readFileSync(_p + '.public').toString();
      self.i2p_private_key_udp = fs.readFileSync(_p + '.private').toString();
    } else {
      const obj = await Config.createI2PDestination(self);
      self.i2p_public_key_udp = obj.public;
      self.i2p_private_key_udp = obj.private;
    }
    self.udp = self.i2p_public_key_udp;

    //@TODO max is hardcoded (3)
    // i2p tunnel length variance
    self.i2p_sam_tunnel_var_min = Config.b(
      c.i2p_sam_tunnel_var_min || process.env.I2P_SAM_TUNNEL_VAR_MIN || DEFAULT_I2P_SAM_TUNNEL_VAR_MIN,
      0,
      3
    );
    self.i2p_sam_tunnel_var_max = Config.b(
      c.i2p_sam_tunnel_var_max || process.env.I2P_SAM_TUNNEL_VAR_MAX || DEFAULT_I2P_SAM_TUNNEL_VAR_MAX,
      self.i2p_sam_tunnel_var_min,
      3
    );

    if (!c.path_genesis || !fs.existsSync(c.path_genesis)) {
      self.path_genesis = path.join(self.path_app, 'genesis/');
    } else {
      self.path_genesis = c.path_genesis;
    }
    if (!/\.json$/.test(self.path_genesis)) {
      self.path_genesis = self.path_genesis + DEFAULT_NAME_GENESIS + '.json';
    }
    if (!fs.existsSync(self.path_genesis)) {
      throw new Error(`Path to genesis block not found: ${self.path_genesis}`);
    }

    if (!c.path_chain || !fs.existsSync(c.path_chain)) {
      self.path_chain = path.join(self.path_app, 'db/chain/');
    } else {
      self.path_chain = c.path_chain;
    }
    if (!fs.existsSync(self.path_chain)) {
      throw new Error(`Path to the database not found: ${self.path_chain}`);
    }

    if (!c.path_state || !fs.existsSync(c.path_state)) {
      self.path_state = path.join(self.path_app, 'db/state/');
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

    self.chain_max_txs_in_memory = Config.b(
      c.chain_max_txs_in_memory || process.env.BLOCKCHAIN_MAX_TXS_IN_MEMORY || MAX_CHAIN_MAX_TXS_IN_MEMORY,
      MIN_CHAIN_MAX_TXS_IN_MEMORY,
      MAX_CHAIN_MAX_TXS_IN_MEMORY
    );
    self.api_max_query_size = Config.b(
      c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE,
      MIN_API_MAX_QUERY_SIZE,
      MAX_API_MAX_QUERY_SIZE
    );

    return self;
  }

  private static async createI2PDestination(
    self: Config
  ): Promise<{ address: string; public: string; private: string }> {
    const [host, port] = self.i2p_sam_http.split(':');
    const sam: { address: string; public: string; private: string } = await createLocalDestination({
      sam: {
        host: host,
        portTCP: Number(port),
      },
    });

    const pathDestination = path.join(self.path_keys, sam.address);
    if (fs.existsSync(pathDestination + '.public') || fs.existsSync(pathDestination + '.private')) {
      throw new Error(`Address already exists: ${pathDestination}`);
    }
    fs.writeFileSync(pathDestination + '.public', sam.public, { mode: '0644' });
    fs.writeFileSync(pathDestination + '.private', sam.private, { mode: '0600' });

    return sam;
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
