"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Network = void 0;
const logger_1 = require("../logger");
const message_1 = require("./message/message");
const events_1 = __importDefault(require("events"));
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const util_1 = require("../chain/util");
const simple_get_1 = __importDefault(require("simple-get"));
const socks_proxy_agent_1 = require("socks-proxy-agent");
const status_1 = require("./message/status");
class Network extends events_1.default {
    constructor(server, onMessage) {
        super();
        this.samForward = {};
        this.samUDP = {};
        this.arrayNetwork = [];
        this.arrayBroadcast = [];
        this.mapMsgSeq = new Map();
        this.mapOnline = new Map();
        this.isClosing = false;
        this.timeoutP2P = {};
        this.timeoutStatus = {};
        this.server = server;
        this.publicKey = this.server.getWallet().getPublicKey();
        logger_1.Logger.info(`Network, public key: ${this.publicKey}`);
        this.agent = new socks_proxy_agent_1.SocksProxyAgent(`socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`, { timeout: this.server.config.network_timeout_ms });
        logger_1.Logger.info(`Network, using SOCKS: socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`);
        if (this.server.config.bootstrap) {
            this.bootstrapNetwork();
        }
        logger_1.Logger.info(`P2P starting on ${(0, i2p_sam_1.toB32)(this.server.config.udp)}.b32.i2p`);
        this.init();
        this._onMessage = onMessage;
    }
    static make(server, onMessage) {
        return new Network(server, onMessage);
    }
    shutdown() {
        clearTimeout(this.timeoutP2P);
        clearTimeout(this.timeoutStatus);
        this.isClosing = true;
        typeof this.agent.destroy === 'function' && this.agent.destroy();
        typeof this.samForward.close === 'function' && this.samForward.close();
        this.samForward = {};
        typeof this.samUDP.close === 'function' && this.samUDP.close();
        this.samUDP = {};
    }
    init(started = false, retry = 0) {
        retry++;
        if (retry > 60) {
            throw new Error(`P2P failed on ${(0, i2p_sam_1.toB32)(this.server.config.udp)}.b32.i2p`);
        }
        if (this.hasP2PNetwork()) {
            this.emit('ready');
            logger_1.Logger.info(`P2P ready on ${(0, i2p_sam_1.toB32)(this.server.config.udp)}.b32.i2p`);
        }
        else {
            setTimeout(() => {
                this.init(true, retry);
            }, 2000);
        }
        if (started) {
            return;
        }
        (async () => {
            const _c = this.server.config;
            this.samForward = (await (0, i2p_sam_1.createForward)({
                sam: {
                    host: _c.i2p_sam_http_host,
                    portTCP: _c.i2p_sam_http_port_tcp,
                    publicKey: _c.i2p_public_key_http,
                    privateKey: _c.i2p_private_key_http,
                },
                forward: {
                    host: _c.i2p_sam_forward_http_host,
                    port: _c.i2p_sam_forward_http_port,
                    silent: true,
                },
            })).on('error', (error) => {
                logger_1.Logger.warn(`${this.publicKey}: SAM HTTP ${error.toString()}`);
            });
            logger_1.Logger.info(`HTTP ${(0, i2p_sam_1.toB32)(_c.http)}.b32.i2p to ${_c.i2p_sam_forward_http_host}:${_c.i2p_sam_forward_http_port}`);
            this.samUDP = (await (0, i2p_sam_1.createDatagram)({
                sam: {
                    host: _c.i2p_sam_udp_host,
                    portTCP: _c.i2p_sam_udp_port_tcp,
                    publicKey: _c.i2p_public_key_udp,
                    privateKey: _c.i2p_private_key_udp,
                },
                listen: {
                    address: _c.i2p_sam_listen_udp_host,
                    port: _c.i2p_sam_listen_udp_port,
                    hostForward: _c.i2p_sam_forward_udp_host,
                    portForward: _c.i2p_sam_forward_udp_port,
                },
            }))
                .on('data', (data, from) => {
                this.incomingData(data, from);
            })
                .on('error', (error) => {
                logger_1.Logger.warn(`${this.publicKey}: SAM UDP ${error.toString()}`);
            });
            logger_1.Logger.info(`UDP ${(0, i2p_sam_1.toB32)(_c.udp)}.b32.i2p to ${_c.i2p_sam_forward_udp_host}:${_c.i2p_sam_forward_udp_port}`);
        })();
        this.p2pNetwork();
    }
    hasP2PNetwork() {
        return (this.arrayNetwork.length > [...this.server.getBlockchain().getMapPeer().values()].length * 0.5 &&
            Object.keys(this.samForward).length > 0 &&
            Object.keys(this.samUDP).length > 0);
    }
    incomingData(data, from) {
        if (this.isClosing || !this.arrayNetwork.length) {
            return;
        }
        const pk = this.server.getBlockchain().getPublicKeyByUdp(from);
        const m = new message_1.Message(data);
        if (!pk || !this.server.getValidation().validateMessage(m)) {
            return;
        }
        const keySeq = [m.type(), m.origin()].join();
        if ((this.mapMsgSeq.get(keySeq) || 0) < m.seq()) {
            this.mapMsgSeq.set(keySeq, m.seq());
            this.mapOnline.set(pk, Date.now());
            this._onMessage(m);
            m.type() !== message_1.Message.TYPE_STATUS && pk === m.origin() && this.broadcast(m, true);
        }
    }
    p2pNetwork() {
        const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
        this.timeoutP2P = setTimeout(() => {
            this.p2pNetwork();
        }, this.server.config.network_p2p_interval_ms);
        if (aNetwork.length < 2 || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
            return;
        }
        this.arrayNetwork = aNetwork.sort((p1, p2) => (p1.publicKey > p2.publicKey ? 1 : -1));
        this.arrayBroadcast = util_1.Util.shuffleArray(this.arrayNetwork.map((p) => p.publicKey).filter((pk) => pk !== this.publicKey));
        this.mapOnline.set(this.publicKey, Date.now());
        this.timeoutStatus = setTimeout(() => {
            this.broadcast(new status_1.Status().create(this.server.getWallet(), status_1.ONLINE, this.server.getBlockchain().getHeight()));
        }, Math.floor(Math.random() * this.server.config.network_p2p_interval_ms * 0.99));
    }
    isOnline(publicKey) {
        return this.publicKey === publicKey ||
            (this.mapOnline.get(publicKey) || 0) > Date.now() - (this.server.config.network_p2p_interval_ms * 3);
    }
    getArrayNetwork() {
        return this.arrayNetwork;
    }
    getArrayOnline() {
        return [...this.mapOnline.keys()];
    }
    broadcast(m, isFinalHop = false) {
        const msg = m.asBuffer();
        if (isFinalHop && m.dest() !== '') {
            m.dest() !== m.origin() && this.samUDP.send(this.server.getBlockchain().getPeer(m.dest()).udp, msg);
        }
        else {
            this.arrayBroadcast.forEach((pk) => {
                m.origin() !== pk && this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, msg);
            });
        }
    }
    async fetchFromApi(endpoint, timeout = 0) {
        if (endpoint.indexOf('http://') === 0) {
            try {
                const json = await this.fetch(endpoint);
                return JSON.parse(json);
            }
            catch (error) {
                logger_1.Logger.warn(`Network.fetchFromApi() ${endpoint} - ${error.toString()}`);
            }
        }
        else if (this.arrayBroadcast.length) {
            let urlApi = '';
            for (const pk of this.arrayBroadcast) {
                urlApi = `http://${(0, i2p_sam_1.toB32)(this.server.getBlockchain().getPeer(pk).http)}.b32.i2p/${endpoint}`;
                try {
                    return JSON.parse(await this.fetch(urlApi, timeout));
                }
                catch (error) {
                    logger_1.Logger.warn(`Network.fetchFromApi() ${urlApi} - ${error.toString()}`);
                }
            }
        }
        else {
            logger_1.Logger.warn('Network unavailable');
        }
    }
    fetch(url, timeout = 0) {
        const options = {
            url: url,
            agent: this.agent,
            timeout: timeout > 0 ? timeout : this.server.config.network_timeout_ms,
            followRedirects: false,
        };
        return new Promise((resolve, reject) => {
            simple_get_1.default.concat(options, (error, res, data) => {
                if (error || res.statusCode !== 200) {
                    reject(error || new Error(`${res.statusCode}, ${options.url}`));
                }
                else {
                    resolve(data.toString());
                }
            });
        });
    }
    bootstrapNetwork() {
        logger_1.Logger.info('Bootstrapping, using: ' + this.server.config.bootstrap + '/network');
        const _i = setInterval(async () => {
            try {
                this.arrayNetwork = JSON.parse(await this.fetch(this.server.config.bootstrap + '/network'));
            }
            catch (error) {
                logger_1.Logger.warn('Network.populateNetwork() ' + error.toString());
                this.arrayNetwork = [];
            }
            if (this.arrayNetwork.length) {
                clearInterval(_i);
            }
        }, 10000);
    }
}
exports.Network = Network;
