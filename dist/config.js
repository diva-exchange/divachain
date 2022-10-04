"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.STAKE_VOTE_AMOUNT = exports.STAKE_VOTE_BLOCK_DISTANCE = exports.STAKE_VOTE_IDENT = exports.STAKE_PING_QUARTILE_COEFF_MAX = exports.STAKE_PING_QUARTILE_COEFF_MIN = exports.STAKE_PING_AMOUNT = exports.STAKE_PING_SAMPLE_SIZE = exports.STAKE_PING_IDENT = exports.MAX_NETWORK_SIZE = exports.DEFAULT_NAME_GENESIS_BLOCK = exports.BLOCK_VERSION = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const genesis_1 = require("./genesis");
exports.BLOCK_VERSION = 7;
exports.DEFAULT_NAME_GENESIS_BLOCK = 'block.v' + exports.BLOCK_VERSION;
exports.MAX_NETWORK_SIZE = 16;
exports.STAKE_PING_IDENT = 'ping';
exports.STAKE_PING_SAMPLE_SIZE = 30;
exports.STAKE_PING_AMOUNT = 1;
exports.STAKE_PING_QUARTILE_COEFF_MIN = 0.4;
exports.STAKE_PING_QUARTILE_COEFF_MAX = 0.6;
exports.STAKE_VOTE_IDENT = 'vote';
exports.STAKE_VOTE_BLOCK_DISTANCE = 50;
exports.STAKE_VOTE_AMOUNT = 1;
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
const MIN_NETWORK_P2P_INTERVAL_MS = 5000;
const MAX_NETWORK_P2P_INTERVAL_MS = 30000;
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
        this.VERSION = '';
        this.ip = '';
        this.port = 0;
        this.port_block_feed = 0;
        this.path_app = '';
        this.path_genesis = '';
        this.path_blockstore = '';
        this.path_state = '';
        this.path_keys = '';
        this.http = '';
        this.udp = '';
        this.i2p_socks_host = '';
        this.i2p_socks_port = 0;
        this.i2p_sam_http_host = '';
        this.i2p_sam_http_port_tcp = 0;
        this.i2p_sam_udp_host = '';
        this.i2p_sam_udp_port_tcp = 0;
        this.i2p_sam_udp_port_udp = 0;
        this.i2p_sam_forward_http_host = '';
        this.i2p_sam_forward_http_port = 0;
        this.i2p_sam_listen_udp_host = '';
        this.i2p_sam_listen_udp_port = 0;
        this.i2p_sam_forward_udp_host = '';
        this.i2p_sam_forward_udp_port = 0;
        this.i2p_public_key_http = '';
        this.i2p_private_key_http = '';
        this.i2p_public_key_udp = '';
        this.i2p_private_key_udp = '';
        this.network_timeout_ms = 0;
        this.network_p2p_interval_ms = 0;
        this.network_sync_size = 0;
        this.blockchain_max_blocks_in_memory = 0;
        this.api_max_query_size = 0;
    }
    static async make(c) {
        const self = new Config();
        if (process.env.GENESIS === '1') {
            const obj = await genesis_1.Genesis.create();
            const _p = process.env.GENESIS_PATH || '';
            if (_p && fs_1.default.existsSync(path_1.default.dirname(_p)) && /\.json$/.test(_p)) {
                fs_1.default.writeFileSync(_p, JSON.stringify(obj.genesis), { mode: '0644' });
                const _c = process.env.GENESIS_CONFIG_PATH || '';
                if (_c && fs_1.default.existsSync(path_1.default.dirname(_c)) && /\.config$/.test(_c)) {
                    fs_1.default.writeFileSync(_c, JSON.stringify(obj.config.map((cnf) => {
                        return { http: cnf[1].http, udp: cnf[1].udp };
                    })), { mode: '0644' });
                }
            }
            else {
                process.stdout.write(JSON.stringify(obj.genesis));
            }
            process.exit(0);
        }
        if (Object.keys(process).includes('pkg')) {
            c.path_app = path_1.default.dirname(process.execPath);
        }
        if (!c.path_app || !fs_1.default.existsSync(c.path_app)) {
            self.path_app = path_1.default.join(__dirname, '/../');
        }
        else {
            self.path_app = c.path_app;
        }
        self.debug_performance = Config.tf(process.env.DEBUG_PERFORMANCE);
        self.bootstrap =
            (c.no_bootstrapping || process.env.NO_BOOTSTRAPPING || 0) > 0 ? '' : c.bootstrap || process.env.BOOTSTRAP || '';
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
        self.port_block_feed = Config.port(c.port_block_feed || process.env.BLOCK_FEED_PORT || DEFAULT_BLOCK_FEED_PORT);
        if (!c.path_keys || !fs_1.default.existsSync(c.path_keys)) {
            self.path_keys = path_1.default.join(self.path_app, 'keys/');
        }
        else {
            self.path_keys = c.path_keys;
        }
        if (!fs_1.default.existsSync(self.path_keys)) {
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
            const _b32 = /\.b32\.i2p$/.test(self.http) ? self.http : (0, i2p_sam_1.toB32)(self.http) + '.b32.i2p';
            const _p = path_1.default.join(self.path_keys, _b32);
            self.i2p_public_key_http = fs_1.default.readFileSync(_p + '.public').toString();
            self.i2p_private_key_http = fs_1.default.readFileSync(_p + '.private').toString();
        }
        else {
            const obj = await Config.createI2PDestination(self);
            self.i2p_public_key_http = obj.public;
            self.i2p_private_key_http = obj.private;
        }
        self.http = self.i2p_public_key_http;
        if (self.udp.length > 0) {
            const _b32 = /\.b32\.i2p$/.test(self.udp) ? self.udp : (0, i2p_sam_1.toB32)(self.udp) + '.b32.i2p';
            const _p = path_1.default.join(self.path_keys, _b32);
            self.i2p_public_key_udp = fs_1.default.readFileSync(_p + '.public').toString();
            self.i2p_private_key_udp = fs_1.default.readFileSync(_p + '.private').toString();
        }
        else {
            const obj = await Config.createI2PDestination(self);
            self.i2p_public_key_udp = obj.public;
            self.i2p_private_key_udp = obj.private;
        }
        self.udp = self.i2p_public_key_udp;
        if (!c.path_genesis || !fs_1.default.existsSync(c.path_genesis)) {
            self.path_genesis = path_1.default.join(self.path_app, 'genesis/');
        }
        else {
            self.path_genesis = c.path_genesis;
        }
        if (!/\.json$/.test(self.path_genesis)) {
            self.path_genesis = self.path_genesis + exports.DEFAULT_NAME_GENESIS_BLOCK + '.json';
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
        if (!fs_1.default.existsSync(self.path_blockstore)) {
            throw new Error(`Path to the blockstore database not found: ${self.path_blockstore}`);
        }
        if (!c.path_state || !fs_1.default.existsSync(c.path_state)) {
            self.path_state = path_1.default.join(self.path_app, 'state/');
        }
        else {
            self.path_state = c.path_state;
        }
        if (!fs_1.default.existsSync(self.path_state)) {
            throw new Error(`Path to the state database not found: ${self.path_state}`);
        }
        self.network_timeout_ms = Config.b(c.network_timeout_ms || process.env.NETWORK_TIMEOUT_MS || DEFAULT_NETWORK_TIMEOUT_MS, MIN_NETWORK_TIMEOUT_MS, MAX_NETWORK_TIMEOUT_MS);
        self.network_p2p_interval_ms = Config.b(c.network_p2p_interval_ms || process.env.NETWORK_P2P_INTERVAL_MS, MIN_NETWORK_P2P_INTERVAL_MS, MAX_NETWORK_P2P_INTERVAL_MS);
        self.network_sync_size = Config.b(c.network_sync_size || process.env.NETWORK_SYNC_SIZE, MIN_NETWORK_SYNC_SIZE, MAX_NETWORK_SYNC_SIZE);
        self.blockchain_max_blocks_in_memory = Config.b(c.blockchain_max_blocks_in_memory ||
            process.env.BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY ||
            MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY, MIN_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY, MAX_BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY);
        self.api_max_query_size = Config.b(c.api_max_query_size || process.env.API_MAX_QUERY_SIZE || MAX_API_MAX_QUERY_SIZE, MIN_API_MAX_QUERY_SIZE, MAX_API_MAX_QUERY_SIZE);
        return self;
    }
    static async createI2PDestination(self) {
        const obj = await (0, i2p_sam_1.createLocalDestination)({
            sam: {
                host: self.i2p_sam_http_host,
                portTCP: self.i2p_sam_http_port_tcp,
            },
        });
        const pathDestination = path_1.default.join(self.path_keys, obj.address);
        if (fs_1.default.existsSync(pathDestination + '.public') || fs_1.default.existsSync(pathDestination + '.private')) {
            throw new Error(`Address already exists: ${pathDestination}`);
        }
        fs_1.default.writeFileSync(pathDestination + '.public', obj.public, { mode: '0644' });
        fs_1.default.writeFileSync(pathDestination + '.private', obj.private, { mode: '0600' });
        return obj;
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
exports.Config = Config;
