"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Genesis = void 0;
const path_1 = __importDefault(require("path"));
const blockchain_1 = require("./chain/blockchain");
const config_1 = require("./config");
const wallet_1 = require("./chain/wallet");
const util_1 = require("./chain/util");
class Genesis {
    static async create(pathApplication = '') {
        process.env.GENESIS = '0';
        const SIZE_NETWORK = Number(process.env.SIZE_NETWORK || 9);
        if (SIZE_NETWORK > config_1.MAX_NETWORK_SIZE) {
            throw new Error(`Maximum network size: ${config_1.MAX_NETWORK_SIZE}. Larger network not supported.`);
        }
        const IP = process.env.IP || '127.27.27.1';
        const BASE_PORT = Number(process.env.BASE_PORT || 17000);
        const BASE_PORT_FEED = Number(process.env.BASE_PORT_FEED || 18000);
        const I2P_SOCKS_HOST = process.env.I2P_SOCKS_HOST || '';
        const I2P_SOCKS_PORT = I2P_SOCKS_HOST ? Number(process.env.I2P_SOCKS_PORT || 4445) : 0;
        const I2P_SAM_HTTP_HOST = process.env.I2P_SAM_HTTP_HOST || I2P_SOCKS_HOST;
        const I2P_SAM_HTTP_PORT_TCP = I2P_SAM_HTTP_HOST ? Number(process.env.I2P_SAM_HTTP_PORT_TCP || 7656) : 0;
        const I2P_SAM_UDP_HOST = process.env.I2P_SAM_UDP_HOST || I2P_SAM_HTTP_HOST;
        const I2P_SAM_UDP_PORT_TCP = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_TCP || 7656) : 0;
        const I2P_SAM_UDP_PORT_UDP = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_UDP_PORT_UDP || 7655) : 0;
        const I2P_SAM_FORWARD_HTTP_HOST = I2P_SAM_HTTP_HOST ? process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1' : '';
        const I2P_SAM_FORWARD_HTTP_PORT = I2P_SAM_HTTP_HOST
            ? Number(process.env.I2P_SAM_FORWARD_HTTP_PORT || BASE_PORT)
            : 0;
        const I2P_SAM_LISTEN_UDP_HOST = I2P_SAM_UDP_HOST ? process.env.I2P_SAM_LISTEN_UDP_HOST || '0.0.0.0' : '';
        const I2P_SAM_LISTEN_UDP_PORT = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_LISTEN_UDP_PORT || 19000) : 0;
        const I2P_SAM_FORWARD_UDP_HOST = I2P_SAM_UDP_HOST ? process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1' : '';
        const I2P_SAM_FORWARD_UDP_PORT = I2P_SAM_UDP_HOST ? Number(process.env.I2P_SAM_FORWARD_UDP_PORT || 19000) : 0;
        const pathApp = pathApplication || path_1.default.join(__dirname, '/../');
        const pathGenesis = path_1.default.join(__dirname, '/../genesis', config_1.DEFAULT_NAME_GENESIS_BLOCK + '.json');
        const genesis = blockchain_1.Blockchain.genesis(pathGenesis);
        const map = new Map();
        const cmds = [];
        let s = 1;
        let config = {};
        for (let i = 1; i <= SIZE_NETWORK; i++) {
            config = await config_1.Config.make({
                no_bootstrapping: 1,
                ip: IP,
                port: BASE_PORT + i,
                port_block_feed: BASE_PORT_FEED + i,
                path_app: pathApp,
                path_genesis: pathGenesis,
                blockchain_max_blocks_in_memory: 100,
                i2p_socks_host: I2P_SOCKS_HOST,
                i2p_socks_port: I2P_SOCKS_PORT,
                i2p_sam_http_host: I2P_SAM_HTTP_HOST,
                i2p_sam_http_port_tcp: I2P_SAM_HTTP_PORT_TCP,
                i2p_sam_udp_host: I2P_SAM_UDP_HOST,
                i2p_sam_udp_port_tcp: I2P_SAM_UDP_PORT_TCP,
                i2p_sam_udp_port_udp: I2P_SAM_UDP_PORT_UDP,
                i2p_sam_forward_http_host: I2P_SAM_FORWARD_HTTP_HOST,
                i2p_sam_forward_http_port: I2P_SAM_FORWARD_HTTP_PORT > 0 ? I2P_SAM_FORWARD_HTTP_PORT + i : 0,
                i2p_sam_listen_udp_host: I2P_SAM_LISTEN_UDP_HOST,
                i2p_sam_listen_udp_port: I2P_SAM_LISTEN_UDP_PORT > 0 ? I2P_SAM_LISTEN_UDP_PORT + i : 0,
                i2p_sam_forward_udp_host: I2P_SAM_FORWARD_UDP_HOST,
                i2p_sam_forward_udp_port: I2P_SAM_FORWARD_UDP_PORT > 0 ? I2P_SAM_FORWARD_UDP_PORT + i : 0,
                http: I2P_SAM_HTTP_HOST ? '' : `${IP}:${BASE_PORT + i}`,
                udp: I2P_SAM_UDP_HOST ? '' : `${IP}:${BASE_PORT + 3000 + i}`,
            });
            const publicKey = wallet_1.Wallet.make(config).getPublicKey();
            map.set(publicKey, config);
            cmds.push({
                seq: s,
                command: 'addPeer',
                http: config.http,
                udp: config.udp,
                publicKey: publicKey,
            });
            s++;
        }
        genesis.tx = [
            {
                ident: 'genesis',
                origin: '0000000000000000000000000000000000000000000',
                commands: cmds,
                sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            },
        ];
        genesis.hash = util_1.Util.hash([genesis.version, genesis.previousHash, JSON.stringify(genesis.tx), genesis.height].join());
        return Promise.resolve({ genesis: genesis, config: [...map] });
    }
}
exports.Genesis = Genesis;
