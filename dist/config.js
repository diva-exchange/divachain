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
export const TX_VERSION = 1;
export const DEFAULT_NAME_GENESIS = 'tx.v' + TX_VERSION;
export const MAX_NETWORK_SIZE = 24;
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_TX_FEED_PORT = DEFAULT_PORT + 1;
const DEFAULT_I2P_SOCKS_PORT = 4445;
const DEFAULT_I2P_SAM_FORWARD_HTTP_PORT = DEFAULT_PORT;
const DEFAULT_I2P_SAM_TCP_PORT = 7656;
const DEFAULT_I2P_SAM_UDP_PORT = 7656;
const DEFAULT_I2P_SAM_UDP_PORT_UDP = 7655;
const DEFAULT_I2P_SAM_LISTEN_UDP_PORT = DEFAULT_PORT + 2;
const DEFAULT_I2P_SAM_FORWARD_UDP_PORT = DEFAULT_I2P_SAM_LISTEN_UDP_PORT;
const DEFAULT_I2P_SAM_TUNNEL_VAR_MIN = 0;
const DEFAULT_I2P_SAM_TUNNEL_VAR_MAX = 2;
const DEFAULT_NETWORK_TIMEOUT_MS = 10000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const MIN_NETWORK_P2P_INTERVAL_MS = 10000;
const MAX_NETWORK_P2P_INTERVAL_MS = 30000;
const MIN_NETWORK_SYNC_SIZE = 10;
const MAX_NETWORK_SYNC_SIZE = 100;
const MIN_CHAIN_MAX_TXS_IN_MEMORY = 100;
const MAX_CHAIN_MAX_TXS_IN_MEMORY = 1000;
const MIN_API_MAX_QUERY_SIZE = 10;
const MAX_API_MAX_QUERY_SIZE = 100;
export class Config {
    is_testnet = true;
    debug_performance = false;
    bootstrap = '';
    VERSION = '';
    ip = '';
    port = 0;
    port_tx_feed = 0;
    path_app = '';
    path_genesis = '';
    path_chain = '';
    path_state = '';
    path_keys = '';
    i2p_socks = '';
    i2p_sam_http = '';
    i2p_sam_forward_http = '';
    i2p_public_key_http = '';
    i2p_private_key_http = '';
    http = '';
    i2p_sam_udp = '';
    i2p_sam_udp_port_udp = 0; // specs 7655
    i2p_sam_listen_udp = '';
    i2p_sam_forward_udp = '';
    i2p_public_key_udp = '';
    i2p_private_key_udp = '';
    udp = '';
    i2p_sam_tunnel_var_min = 0;
    i2p_sam_tunnel_var_max = 0;
    network_timeout_ms = 0;
    network_p2p_interval_ms = 0;
    network_sync_size = 0;
    chain_max_txs_in_memory = 0;
    api_max_query_size = 0;
    static async make(c) {
        const ___dirname = path.dirname(import.meta.url.replace(/^file:\/\//, ''));
        const self = new Config();
        // TESTNET mode
        self.is_testnet = (process.env.IS_TESTNET || false) === '1';
        // GENESIS mode
        if (process.env.GENESIS === '1') {
            const obj = await Genesis.create();
            const _p = process.env.GENESIS_PATH || '';
            if (_p && fs.existsSync(path.dirname(_p)) && /\.json$/.test(_p)) {
                fs.writeFileSync(_p, JSON.stringify(obj.genesis), { mode: '0644' });
                const _c = process.env.GENESIS_CONFIG_PATH || '';
                if (_c && fs.existsSync(path.dirname(_c)) && /\.config$/.test(_c)) {
                    fs.writeFileSync(_c, JSON.stringify(obj.config.map((cnf) => {
                        return { http: cnf[1].http, tcp: cnf[1].tcp };
                    })), { mode: '0644' });
                }
            }
            else {
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
        }
        else {
            self.path_app = c.path_app;
        }
        self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);
        self.bootstrap =
            +(c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';
        try {
            self.VERSION = fs.readFileSync(path.join(___dirname, 'version')).toString();
        }
        catch (error) {
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
        }
        else {
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
            const _b32 = /\.b32\.i2p$/.test(self.http) ? self.http : toB32(self.http) + '.b32.i2p';
            const _p = path.join(self.path_keys, _b32);
            self.i2p_public_key_http = fs.readFileSync(_p + '.public').toString();
            self.i2p_private_key_http = fs.readFileSync(_p + '.private').toString();
        }
        else {
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
            const _b32 = /\.b32\.i2p$/.test(self.udp) ? self.udp : toB32(self.udp) + '.b32.i2p';
            const _p = path.join(self.path_keys, _b32);
            self.i2p_public_key_udp = fs.readFileSync(_p + '.public').toString();
            self.i2p_private_key_udp = fs.readFileSync(_p + '.private').toString();
        }
        else {
            const obj = await Config.createI2PDestination(self);
            self.i2p_public_key_udp = obj.public;
            self.i2p_private_key_udp = obj.private;
        }
        self.udp = self.i2p_public_key_udp;
        //@TODO max is hardcoded (3)
        // i2p tunnel length variance
        self.i2p_sam_tunnel_var_min = Config.b(c.i2p_sam_tunnel_var_min || process.env.I2P_SAM_TUNNEL_VAR_MIN || DEFAULT_I2P_SAM_TUNNEL_VAR_MIN, 0, 3);
        self.i2p_sam_tunnel_var_max = Config.b(c.i2p_sam_tunnel_var_max || process.env.I2P_SAM_TUNNEL_VAR_MAX || DEFAULT_I2P_SAM_TUNNEL_VAR_MAX, self.i2p_sam_tunnel_var_min, 3);
        if (!c.path_genesis || !fs.existsSync(c.path_genesis)) {
            self.path_genesis = path.join(self.path_app, 'genesis/');
        }
        else {
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
        }
        else {
            self.path_chain = c.path_chain;
        }
        if (!fs.existsSync(self.path_chain)) {
            throw new Error(`Path to the database not found: ${self.path_chain}`);
        }
        if (!c.path_state || !fs.existsSync(c.path_state)) {
            self.path_state = path.join(self.path_app, 'db/state/');
        }
        else {
            self.path_state = c.path_state;
        }
        if (!fs.existsSync(self.path_state)) {
            throw new Error(`Path to the state database not found: ${self.path_state}`);
        }
        self.network_timeout_ms = Config.b(c.network_timeout_ms || process.env.NETWORK_TIMEOUT_MS || DEFAULT_NETWORK_TIMEOUT_MS, MIN_NETWORK_TIMEOUT_MS, MAX_NETWORK_TIMEOUT_MS);
        self.network_p2p_interval_ms = Config.b(c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS, MIN_NETWORK_P2P_INTERVAL_MS, MAX_NETWORK_P2P_INTERVAL_MS);
        self.network_sync_size = Config.b(c.network_sync_size || process.env.NETWORK_SYNC_SIZE, MIN_NETWORK_SYNC_SIZE, MAX_NETWORK_SYNC_SIZE);
        self.chain_max_txs_in_memory = Config.b(c.chain_max_txs_in_memory || process.env.BLOCKCHAIN_MAX_TXS_IN_MEMORY || MAX_CHAIN_MAX_TXS_IN_MEMORY, MIN_CHAIN_MAX_TXS_IN_MEMORY, MAX_CHAIN_MAX_TXS_IN_MEMORY);
        self.api_max_query_size = Config.b(c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE, MIN_API_MAX_QUERY_SIZE, MAX_API_MAX_QUERY_SIZE);
        return self;
    }
    static async createI2PDestination(self) {
        const [host, port] = self.i2p_sam_http.split(':');
        const sam = await createLocalDestination({
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
    static tf(n) {
        return Number(n) > 0;
    }
    static b(n, min, max) {
        n = Number(n);
        min = Math.floor(min);
        max = Math.ceil(max);
        return n >= min && n <= max ? Math.floor(n) : n > max ? max : min;
    }
    static port(n) {
        return Number(n) ? Config.b(Number(n), 1025, 65535) : 0;
    }
}
//# sourceMappingURL=config.js.map