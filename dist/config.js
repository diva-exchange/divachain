"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.MAX_NETWORK_PING_INTERVAL_MS = exports.MIN_NETWORK_PING_INTERVAL_MS = exports.PBFT_RETRY_INTERVAL_MS = exports.DEFAULT_NAME_GENESIS_BLOCK = exports.BLOCK_VERSION = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const net_1 = __importDefault(require("net"));
exports.BLOCK_VERSION = 3;
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 17468;
const DEFAULT_PORT_BLOCK_FEED = 17469;
const DEFAULT_I2P_SOCKS_PORT = 4445;
const DEFAULT_I2P_SAM_PORT_TCP = 7656;
const DEFAULT_I2P_SAM_PORT_UDP = 7655;
exports.DEFAULT_NAME_GENESIS_BLOCK = 'block.v' + exports.BLOCK_VERSION;
exports.PBFT_RETRY_INTERVAL_MS = 1000;
const MIN_NETWORK_SIZE = 7;
const MAX_NETWORK_SIZE = 64;
const MIN_NETWORK_MORPH_INTERVAL_MS = 300000;
const MAX_NETWORK_MORPH_INTERVAL_MS = 600000;
const MIN_NETWORK_P2P_INTERVAL_MS = 3000;
const MAX_NETWORK_P2P_INTERVAL_MS = 10000;
const MIN_NETWORK_AUTH_TIMEOUT_MS = 30000;
const MAX_NETWORK_AUTH_TIMEOUT_MS = 60000;
exports.MIN_NETWORK_PING_INTERVAL_MS = 5000;
exports.MAX_NETWORK_PING_INTERVAL_MS = 10000;
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
class Config {
    constructor() {
        this.debug_performance = false;
        this.bootstrap = '';
        this.path_app = '';
        this.VERSION = '';
        this.ip = '';
        this.port = 0;
        this.port_block_feed = 0;
        this.path_genesis = '';
        this.path_blockstore = '';
        this.path_state = '';
        this.path_keys = '';
        this.i2p_socks_host = '';
        this.i2p_socks_port = 0;
        this.i2p_has_socks = false;
        this.i2p_sam_host = '';
        this.i2p_sam_port_tcp = 0;
        this.i2p_sam_port_udp = 0;
        this.i2p_sam_listen_address = '';
        this.i2p_sam_listen_port = 0;
        this.i2p_sam_listen_forward_host = '';
        this.i2p_sam_listen_forward_port = 0;
        this.i2p_has_sam = false;
        this.i2p_b32_address = '';
        this.i2p_public_key = '';
        this.i2p_private_key = '';
        this.address = '';
        this.network_size = MIN_NETWORK_SIZE;
        this.network_morph_interval_ms = MIN_NETWORK_MORPH_INTERVAL_MS;
        this.network_p2p_interval_ms = MIN_NETWORK_P2P_INTERVAL_MS;
        this.network_auth_timeout_ms = MIN_NETWORK_AUTH_TIMEOUT_MS;
        this.network_clean_interval_ms = MIN_NETWORK_CLEAN_INTERVAL_MS;
        this.network_ping_interval_ms = exports.MIN_NETWORK_PING_INTERVAL_MS;
        this.network_stale_threshold = MIN_NETWORK_STALE_THRESHOLD;
        this.network_sync_size = MIN_NETWORK_SYNC_SIZE;
        this.network_verbose_logging = false;
        this.blockchain_max_blocks_in_memory = MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY;
        this.api_max_query_size = MAX_API_MAX_QUERY_SIZE;
    }
    static async make(c) {
        const self = new Config();
        self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);
        self.bootstrap =
            (c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';
        if (!c.path_app || !fs_1.default.existsSync(c.path_app)) {
            self.path_app = path_1.default.join(__dirname, '/../');
        }
        else {
            self.path_app = c.path_app;
        }
        try {
            self.VERSION = fs_1.default.readFileSync(path_1.default.join(__dirname, 'version')).toString();
        }
        catch (error) {
            if (!fs_1.default.existsSync(path_1.default.join(self.path_app, 'package.json'))) {
                throw new Error('File not found: ' + path_1.default.join(self.path_app, 'package.json'));
            }
            self.VERSION = require(path_1.default.join(self.path_app, 'package.json')).version;
        }
        self.ip = c.ip || process.env.IP || DEFAULT_IP;
        self.port = Config.port(c.port || process.env.PORT || DEFAULT_PORT);
        self.port_block_feed = Config.port(c.port_block_feed || process.env.PORT_BLOCK_FEED || DEFAULT_PORT_BLOCK_FEED);
        const nameBlockGenesis = process.env.NAME_BLOCK_GENESIS
            ? process.env.NAME_BLOCK_GENESIS.replace(/[^a-z0-9._-]|^[._-]+|[._-]+$/gi, '')
            : exports.DEFAULT_NAME_GENESIS_BLOCK;
        if (!c.path_genesis || !fs_1.default.existsSync(c.path_genesis)) {
            self.path_genesis = path_1.default.join(self.path_app, 'genesis/');
        }
        else {
            self.path_genesis = c.path_genesis;
        }
        if (!/\.json$/.test(self.path_genesis)) {
            self.path_genesis = self.path_genesis + nameBlockGenesis + '.json';
        }
        if (!fs_1.default.existsSync(self.path_genesis)) {
            throw new Error(`Path to genesis block not found: ${self.path_genesis}`);
        }
        if (!c.path_blockstore || !fs_1.default.existsSync(c.path_blockstore)) {
            self.path_blockstore = path_1.default.join(self.path_app, 'blockstore/');
        }
        else {
            self.path_blockstore = c.path_blockstore;
        }
        if (!c.path_state || !fs_1.default.existsSync(c.path_state)) {
            self.path_state = path_1.default.join(self.path_app, 'state/');
        }
        else {
            self.path_state = c.path_state;
        }
        if (!c.path_keys || !fs_1.default.existsSync(c.path_keys)) {
            self.path_keys = path_1.default.join(self.path_app, 'keys/');
        }
        else {
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
            const pathDestination = path_1.default.join(self.path_keys, self.address);
            if (!self.address) {
                const obj = await (0, i2p_sam_1.createLocalDestination)({
                    sam: {
                        host: self.i2p_sam_host,
                        portTCP: self.i2p_sam_port_tcp,
                    },
                });
                self.i2p_private_key = obj.private;
                self.i2p_public_key = obj.public;
                self.i2p_b32_address = obj.address;
                self.address = self.i2p_b32_address;
                fs_1.default.writeFileSync(path_1.default.join(self.path_keys, self.address) + '.public', self.i2p_public_key);
                fs_1.default.writeFileSync(path_1.default.join(self.path_keys, self.address) + '.private', self.i2p_private_key);
            }
            else if (/\.b32\.i2p$/.test(self.address) && fs_1.default.existsSync(pathDestination)) {
                self.i2p_b32_address = self.address;
                self.i2p_public_key = fs_1.default.readFileSync(pathDestination + '.public').toString();
                self.i2p_private_key = fs_1.default.readFileSync(pathDestination + '.private').toString();
            }
            else {
                throw new Error(`Fatal: invalid I2P address (${self.address})`);
            }
        }
        else if (!self.address || /\.b32\.i2p$/.test(self.address)) {
            throw new Error(`Fatal: invalid address (${self.address})`);
        }
        self.network_size = Config.b(c.network_size || process.env.NETWORK_SIZE, MIN_NETWORK_SIZE, MAX_NETWORK_SIZE);
        self.network_morph_interval_ms = Config.b(c.network_morph_interval_ms || process.env.NETWORK_MORPH_INTERVAL_MS, MIN_NETWORK_MORPH_INTERVAL_MS, MAX_NETWORK_MORPH_INTERVAL_MS);
        self.network_p2p_interval_ms = Config.b(c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS, MIN_NETWORK_P2P_INTERVAL_MS, MAX_NETWORK_P2P_INTERVAL_MS);
        self.network_auth_timeout_ms = Config.b(c.network_auth_timeout_ms || process.env.NETWORK_AUTH_TIMEOUT_MS, MIN_NETWORK_AUTH_TIMEOUT_MS, MAX_NETWORK_AUTH_TIMEOUT_MS);
        self.network_ping_interval_ms = Config.b(c.network_ping_interval_ms || process.env.NETWORK_PING_INTERVAL_MS, exports.MIN_NETWORK_PING_INTERVAL_MS, exports.MAX_NETWORK_PING_INTERVAL_MS);
        self.network_clean_interval_ms = Config.b(c.network_clean_interval_ms || process.env.NETWORK_CLEAN_INTERVAL_MS, MIN_NETWORK_CLEAN_INTERVAL_MS, MAX_NETWORK_CLEAN_INTERVAL_MS);
        self.network_stale_threshold = Config.b(c.network_stale_threshold || process.env.NETWORK_STALE_THRESHOLD, MIN_NETWORK_STALE_THRESHOLD, MAX_NETWORK_STALE_THRESHOLD);
        self.network_sync_size = Config.b(c.network_sync_size || process.env.NETWORK_SYNC_SIZE, MIN_NETWORK_SYNC_SIZE, MAX_NETWORK_SYNC_SIZE);
        self.network_verbose_logging = Config.tf(c.network_verbose_logging || process.env.NETWORK_VERBOSE_LOGGING);
        self.blockchain_max_blocks_in_memory = Config.b(c.blockchain_max_blocks_in_memory ||
            process.env.BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY ||
            MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY, MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY, MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY);
        self.api_max_query_size = Config.b(c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE, MIN_API_MAX_QUERY_SIZE, MAX_API_MAX_QUERY_SIZE);
        return self;
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
    static async isTCPAvailable(host, port) {
        return new Promise((resolve) => {
            const tcp = new net_1.default.Socket();
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
exports.Config = Config;
