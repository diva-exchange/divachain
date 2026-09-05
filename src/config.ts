/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import denoJSON from '../deno.json' with { type: 'json' };

export const DEFAULT_IP: string = '127.0.0.1';
export const DEFAULT_PORT: number = 17468;
export const DEFAULT_PORT_BLOCK_FEED: number = DEFAULT_PORT + 1;
export const DEFAULT_PORT_API_DEBUG: number = DEFAULT_PORT + 2000;

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
 * Default broadcast interval for status messages: 2 mins
 */
export const DEFAULT_NETWORK_STATUS_BROADCAST_MS: number = 1000 * 60 * 2;
export const DEFAULT_NETWORK_BROADCAST_FANOUT: number = 8;

// TODO review the fixed value
export const DEFAULT_SIZE_MESSAGE_CACHE: number = 24000;

export const MIN_UDP_MESSAGE_BYTES: number = 179;
export const MAX_UDP_MESSAGE_BYTES: number = 32000;

const DEFAULT_NETWORK_TIMEOUT_MS: number = 30000;
const MIN_NETWORK_TIMEOUT_MS: number = 1000;
const MAX_NETWORK_TIMEOUT_MS: number = 60000;
const MIN_NETWORK_P2P_INTERVAL_MS: number = 10000;
const MAX_NETWORK_P2P_INTERVAL_MS: number = 30000;
const MIN_NETWORK_SYNC_SIZE: number = 10;
const MAX_NETWORK_SYNC_SIZE: number = 100;

const MIN_CHAIN_MAX_BLOCKS_IN_MEMORY: number = 100;
const MAX_CHAIN_MAX_BLOCKS_IN_MEMORY: number = 1000;

const MIN_API_MAX_QUERY_SIZE: number = 10;
const MAX_API_MAX_QUERY_SIZE: number = 100;

/**
 * 1 MB (API Reject Limit)
 */
export const LIMIT_SOC_BYTES_SOFT: number = 1_000_000;
/**
 * 10 MB (Protocol FIFO Pruning)
 */
export const LIMIT_SOC_BYTES_HARD: number = 10_000_000;

/**
 * Application Configuration
 */
export class Config {
  public is_testnet: boolean = true;
  public bootstrap: string = '';
  public VERSION: string = '';

  public ip: string = '';
  public port: number = 0;
  public port_block_feed: number = 0;
  public port_api_debug: number = 0;

  public path_genesis_consensus: string = '';
  public path_genesis_soc: string = '';
  public path_peer_seed: string = '';
  public path_consensus: string = '';
  public path_soc: string = '';
  public path_reputation: string = '';
  public path_soc_index: string = '';
  public path_keystore: string = '';
  public path_log: string = '';

  public i2p_socks: string = '';

  public i2p_sam_http: string = '';
  public i2p_sam_forward_http: string = '';

  public i2p_sam_udp: string = '';
  public i2p_sam_udp_port_udp: number = 0; // specs 7655
  public i2p_sam_listen_udp: string = '';
  public i2p_sam_forward_udp: string = '';

  public i2p_sam_tunnel_var_min: number = 0;
  public i2p_sam_tunnel_var_max: number = 0;

  /**
   * Defaults to DEFAULT_NETWORK_TIMEOUT_MS
   */
  public network_timeout_ms: number = 0;
  /**
   * MIN_NETWORK_P2P_INTERVAL_MS: 10000
   *
   * MAX_NETWORK_P2P_INTERVAL_MS: 30000
   *
   * Defaults to MIN_NETWORK_P2P_INTERVAL_MS
   */
  public network_p2p_interval_ms: number = 0;
  public network_sync_size: number = 0;

  public chain_max_blocks_in_memory: number = 0;

  public api_max_query_size: number = 0;

  /**
   * The cryptographic hash of the expected Genesis Consensus Block.
   * Used as the absolute Trust Anchor to prevent Eclipse Attacks during network bootstrap.
   */
  public network_genesis_hash: string = '';

  public decoys: number = 0;

  /**
   * Factory
   * @param c Config
   * @returns Promise<Config>
   */
  static make(c: Config): Config {
    const self: Config = new Config();

    // TESTNET mode
    self.is_testnet = Config.tf(Deno.env.get('IS_TESTNET')) ||
      Config.tf(c.is_testnet);

    // Paths
    self.path_genesis_consensus = c.path_genesis_consensus;
    self.path_genesis_soc = c.path_genesis_soc;
    self.path_peer_seed = c.path_peer_seed;
    self.path_consensus = c.path_consensus;
    self.path_soc = c.path_soc;
    self.path_reputation = c.path_reputation;
    self.path_soc_index = c.path_soc_index;
    self.path_keystore = c.path_keystore || Deno.env.get('PATH_KEYSTORE') ||
      'db/keystore.enc';
    self.path_log = c.path_log;

    self.bootstrap = c.bootstrap || Deno.env.get('BOOTSTRAP') || '';

    self.VERSION = c.VERSION || denoJSON.version;

    self.ip = c.ip || Deno.env.get('IP') || DEFAULT_IP;
    self.port = Config.port(c.port || Deno.env.get('PORT') || DEFAULT_PORT);
    self.port_block_feed = Config.port(
      c.port_block_feed || Deno.env.get('PORT_BLOCK_FEED') ||
        DEFAULT_PORT_BLOCK_FEED,
    );
    self.port_api_debug = Config.port(
      c.port_api_debug || Deno.env.get('PORT_API_DEBUG') ||
        DEFAULT_PORT_API_DEBUG,
    );

    // SOCKS
    self.i2p_socks = c.i2p_socks || Deno.env.get('I2P_SOCKS') ||
      self.ip + ':' + DEFAULT_I2P_SOCKS_PORT;

    // HTTP
    self.i2p_sam_http = c.i2p_sam_http || Deno.env.get('I2P_SAM_HTTP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_HTTP_PORT;
    self.i2p_sam_forward_http = c.i2p_sam_forward_http ||
      Deno.env.get('I2P_SAM_FORWARD_HTTP') ||
      self.ip + ':' + DEFAULT_I2P_SAM_FORWARD_HTTP_PORT;

    // UDP
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

    self.chain_max_blocks_in_memory = Config.b(
      c.chain_max_blocks_in_memory ||
        Deno.env.get('BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY') ||
        MAX_CHAIN_MAX_BLOCKS_IN_MEMORY,
      MIN_CHAIN_MAX_BLOCKS_IN_MEMORY,
      MAX_CHAIN_MAX_BLOCKS_IN_MEMORY,
    );
    self.api_max_query_size = Config.b(
      c.api_max_query_size || Deno.env.get('API_MAX_QUERY_SIZE') ||
        MAX_API_MAX_QUERY_SIZE,
      MIN_API_MAX_QUERY_SIZE,
      MAX_API_MAX_QUERY_SIZE,
    );

    self.network_genesis_hash = c.network_genesis_hash ||
      Deno.env.get('NETWORK_GENESIS_HASH') || '';

    self.decoys = Config.b(
      c.decoys || Deno.env.get('DECOYS') || 0,
      0,
      10,
    );
    return self;
  }

  private static tf(n: unknown): boolean {
    if (typeof n === 'string') {
      return n.toLowerCase() === 'true' || n === '1';
    }
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
