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
export declare const TX_VERSION: number;
export declare const DEFAULT_NAME_GENESIS: string;
export declare const MAX_NETWORK_SIZE: number;
export declare class Config {
    is_testnet: boolean;
    debug_performance: boolean;
    bootstrap: string;
    VERSION: string;
    ip: string;
    port: number;
    port_tx_feed: number;
    path_app: string;
    path_genesis: string;
    path_chain: string;
    path_state: string;
    path_keys: string;
    i2p_socks: string;
    i2p_sam_http: string;
    i2p_sam_forward_http: string;
    i2p_public_key_http: string;
    i2p_private_key_http: string;
    http: string;
    i2p_sam_udp: string;
    i2p_sam_udp_port_udp: number;
    i2p_sam_listen_udp: string;
    i2p_sam_forward_udp: string;
    i2p_public_key_udp: string;
    i2p_private_key_udp: string;
    udp: string;
    i2p_sam_tunnel_var_min: number;
    i2p_sam_tunnel_var_max: number;
    network_timeout_ms: number;
    network_p2p_interval_ms: number;
    network_sync_size: number;
    chain_max_txs_in_memory: number;
    api_max_query_size: number;
    static make(c: Configuration): Promise<Config>;
    private static createI2PDestination;
    private static tf;
    private static b;
    private static port;
}
