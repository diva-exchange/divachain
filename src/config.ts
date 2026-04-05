/**
 * Copyright (C) 2021-2026 diva.exchange
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

import denoJSON from '../deno.json' with { type: 'json' };
import { join as joinPath } from 'node:path';
import { exists } from '@std/fs';
import { createLocalDestination, toB32 } from '@i2p/sam';

type I2PDestination = {
  address: string;
  public: string;
  private: string;
};

export const TX_VERSION: number = 1;
export const DEFAULT_NAME_GENESIS: string = 'tx.v' + TX_VERSION;

export const DEFAULT_IP: string = '127.0.0.1';
export const DEFAULT_PORT: number = 17468;
export const DEFAULT_PORT_TX_FEED: number = DEFAULT_PORT + 1;

export const DEFAULT_I2P_SOCKS_PORT: number = 4445;

export const DEFAULT_I2P_SAM_HTTP_PORT: number = 7656;
export const DEFAULT_I2P_SAM_FORWARD_HTTP_PORT: number = DEFAULT_PORT;

export const DEFAULT_I2P_SAM_UDP_PORT: number = 7656;
const DEFAULT_I2P_SAM_UDP_PORT_UDP: number = 7655;

export const DEFAULT_I2P_SAM_LISTEN_UDP_PORT: number = DEFAULT_PORT + 2;
export const DEFAULT_I2P_SAM_FORWARD_UDP_PORT: number =
  DEFAULT_I2P_SAM_LISTEN_UDP_PORT;

const DEFAULT_I2P_SAM_TUNNEL_VAR_MIN: number = 0;
const DEFAULT_I2P_SAM_TUNNEL_VAR_MAX: number = 2;

/**
 * Default broadcast interval for status messages: 3 mins
 */
export const DEFAULT_NETWORK_STATUS_BROADCAST_MS: number = 1000 * 60 * 3;
/**
 * Default time span to measure reputation: 24h
 */
export const DEFAULT_NETWORK_STATUS_REPUTATION_SPAN_MS: number =
  DEFAULT_NETWORK_STATUS_BROADCAST_MS * 480; // 24h

const DEFAULT_NETWORK_TIMEOUT_MS: number = 30000;
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

/**
 * Application Configuration
 */
export class Config {
  public is_testnet: boolean = true;
  public debug_performance: boolean = false;
  public bootstrap: string = '';
  public VERSION: string = '';

  public ip: string = '';
  public port: number = 0;
  public port_tx_feed: number = 0;

  public path_genesis: string = '';
  public path_peer_seed: string = '';
  public path_chain: string = '';
  public path_state: string = '';
  public path_keys: string = '';
  public path_log: string = '';

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

  /**
   * Defaults to 10secs
   */
  public network_timeout_ms: number = 0;
  /**
   * MIN_NETWORK_P2P_INTERVAL_MS: 10000
   *
   * MAX_NETWORK_P2P_INTERVAL_MS: 30000
   *
   * Defaults to 10 secs
   */
  public network_p2p_interval_ms: number = 0;
  public network_sync_size: number = 0;

  public chain_max_txs_in_memory: number = 0;

  public api_max_query_size: number = 0;

  /**
   * Factory
   * @param c Config
   * @returns Promise<Config>
   */
  static async make(c: Config): Promise<Config> {
    const self: Config = new Config();

    // TESTNET mode
    self.is_testnet = Config.tf(Deno.env.get('IS_TESTNET')) ||
      Config.tf(c.is_testnet);

    self.debug_performance = Config.tf(Deno.env.get('DEBUG_PERFORMANCE')) ||
      Config.tf(c.debug_performance);

    // Paths
    self.path_genesis = c.path_genesis;
    self.path_peer_seed = c.path_peer_seed;
    self.path_chain = c.path_chain;
    self.path_state = c.path_state;
    self.path_keys = c.path_keys;
    self.path_log = c.path_log;

    self.bootstrap = c.bootstrap || Deno.env.get('BOOTSTRAP') || '';

    self.VERSION = c.VERSION || denoJSON.version;

    self.ip = c.ip || Deno.env.get('IP') || DEFAULT_IP;
    self.port = Config.port(c.port || Deno.env.get('PORT') || DEFAULT_PORT);
    self.port_tx_feed = Config.port(
      c.port_tx_feed || Deno.env.get('PORT_TX_FEED') || DEFAULT_PORT_TX_FEED,
    );

    // SOCKS
    self.i2p_socks = c.i2p_socks || Deno.env.get('I2P_SOCKS') ||
      self.ip + ':' + DEFAULT_I2P_SOCKS_PORT;

    // HTTP
    self.http = c.http || Deno.env.get('HTTP') || '';
    self.i2p_sam_http = c.i2p_sam_http || Deno.env.get('I2P_SAM_HTTP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_HTTP_PORT;
    self.i2p_sam_forward_http = c.i2p_sam_forward_http ||
      Deno.env.get('I2P_SAM_FORWARD_HTTP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_FORWARD_HTTP_PORT;
    if (self.http.length > 0) {
      const _b32: string = /\.b32\.i2p$/.test(self.http)
        ? self.http
        : toB32(self.http) + '.b32.i2p';
      const _p: string = joinPath(self.path_keys, _b32);
      self.i2p_public_key_http = await Deno.readTextFile(_p + '.public');
      self.i2p_private_key_http = await Deno.readTextFile(_p + '.private');
    } else {
      const obj: I2PDestination = await Config.createI2PDestination(self);
      self.i2p_public_key_http = obj.public;
      self.i2p_private_key_http = obj.private;
    }
    self.http = self.i2p_public_key_http;

    // UDP
    self.udp = c.udp || Deno.env.get('UDP') || '';
    self.i2p_sam_udp = c.i2p_sam_udp || Deno.env.get('I2P_SAM_UDP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_UDP_PORT;
    self.i2p_sam_udp_port_udp = c.i2p_sam_udp_port_udp ||
      Number(Deno.env.get('I2P_SAM_UDP_PORT_UDP')) ||
      DEFAULT_I2P_SAM_UDP_PORT_UDP;
    self.i2p_sam_listen_udp = c.i2p_sam_listen_udp ||
      Deno.env.get('I2P_SAM_LISTEN_UDP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_LISTEN_UDP_PORT;
    self.i2p_sam_forward_udp = c.i2p_sam_forward_udp ||
      Deno.env.get('I2P_SAM_FORWARD_UDP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_FORWARD_UDP_PORT;
    if (self.udp.length > 0) {
      const _b32: string = /\.b32\.i2p$/.test(self.udp)
        ? self.udp
        : toB32(self.udp) + '.b32.i2p';
      const _p: string = joinPath(self.path_keys, _b32);
      self.i2p_public_key_udp = await Deno.readTextFile(_p + '.public');
      self.i2p_private_key_udp = await Deno.readTextFile(_p + '.private');
    } else {
      const obj = await Config.createI2PDestination(self);
      self.i2p_public_key_udp = obj.public;
      self.i2p_private_key_udp = obj.private;
    }
    self.udp = self.i2p_public_key_udp;

    // TODO max is hardcoded (3)
    // i2p tunnel length variance
    self.i2p_sam_tunnel_var_min = Config.b(
      c.i2p_sam_tunnel_var_min || Deno.env.get('I2P_SAM_TUNNEL_VAR_MIN') ||
        DEFAULT_I2P_SAM_TUNNEL_VAR_MIN,
      0,
      3,
    );
    self.i2p_sam_tunnel_var_max = Config.b(
      c.i2p_sam_tunnel_var_max || Deno.env.get('I2P_SAM_TUNNEL_VAR_MAX') ||
        DEFAULT_I2P_SAM_TUNNEL_VAR_MAX,
      self.i2p_sam_tunnel_var_min,
      3,
    );

    self.network_timeout_ms = Config.b(
      c.network_timeout_ms || Deno.env.get('NETWORK_TIMEOUT_MS') ||
        DEFAULT_NETWORK_TIMEOUT_MS,
      MIN_NETWORK_TIMEOUT_MS,
      MAX_NETWORK_TIMEOUT_MS,
    );

    self.network_p2p_interval_ms = Config.b(
      c.network_p2p_interval_ms || Deno.env.get('NETWORK_P2P_INTERVAL_MS'),
      MIN_NETWORK_P2P_INTERVAL_MS,
      MAX_NETWORK_P2P_INTERVAL_MS,
    );

    self.network_sync_size = Config.b(
      c.network_sync_size || Deno.env.get('NETWORK_SYNC_SIZE'),
      MIN_NETWORK_SYNC_SIZE,
      MAX_NETWORK_SYNC_SIZE,
    );

    self.chain_max_txs_in_memory = Config.b(
      c.chain_max_txs_in_memory ||
        Deno.env.get('BLOCKCHAIN_MAX_TXS_IN_MEMORY') ||
        MAX_CHAIN_MAX_TXS_IN_MEMORY,
      MIN_CHAIN_MAX_TXS_IN_MEMORY,
      MAX_CHAIN_MAX_TXS_IN_MEMORY,
    );
    self.api_max_query_size = Config.b(
      c.api_max_query_size || Deno.env.get('API_MAX_QUERY_SIZE') ||
        MAX_API_MAX_QUERY_SIZE,
      MIN_API_MAX_QUERY_SIZE,
      MAX_API_MAX_QUERY_SIZE,
    );

    return self;
  }

  private static async createI2PDestination(
    self: Config,
  ): Promise<I2PDestination> {
    const [host, port] = self.i2p_sam_http.split(':');
    const sam: { address: string; public: string; private: string } =
      await createLocalDestination({
        sam: {
          host: host,
          portTCP: Number(port),
        },
      });

    const pathDestination: string = joinPath(self.path_keys, sam.address);
    if (
      await exists(pathDestination + '.public') ||
      await exists(pathDestination + '.private')
    ) {
      throw new Error(`Address already exists: ${pathDestination}`);
    }
    await Deno.writeTextFile(pathDestination + '.public', sam.public, {
      mode: 0o444,
    });
    await Deno.writeTextFile(pathDestination + '.private', sam.private, {
      mode: 0o400,
    });

    return sam;
  }

  private static tf(n: unknown): boolean {
    return Number(n) > 0;
  }

  private static b(n: unknown, min: number, max: number): number {
    const num: number = Number(n);
    min = Math.floor(min);
    max = Math.ceil(max);
    return num >= min && num <= max ? Math.floor(num) : num > max ? max : min;
  }

  private static port(n: unknown): number {
    return Number(n) ? Config.b(Number(n), 1025, 65535) : 0;
  }
}
