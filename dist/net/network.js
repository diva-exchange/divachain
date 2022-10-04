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
const sync_1 = require("./message/sync");
const config_1 = require("../config");
class Network extends events_1.default {
    constructor(server, onMessage) {
        super();
        this.samForward = {};
        this.samUDP = {};
        this.identNetwork = '';
        this.arrayNetwork = [];
        this.arrayBroadcast = [];
        this.mapPingSeq = new Map();
        this.mapMsgSeq = new Map();
        this.mapAvailability = new Map();
        this.isClosing = false;
        this.timeoutP2P = {};
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
        this.isClosing = true;
        typeof this.agent.destroy === 'function' && this.agent.destroy();
        typeof this.samForward.close === 'function' && this.samForward.close();
        typeof this.samUDP.close === 'function' && this.samUDP.close();
        clearTimeout(this.timeoutP2P);
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
                logger_1.Logger.warn('SAM HTTP ' + error.toString());
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
                logger_1.Logger.warn('SAM UDP ' + error.toString());
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
        const msg = data.toString().trim();
        const pk = this.server.getBlockchain().getPublicKeyByUdp(from);
        if (!msg || !pk) {
            return;
        }
        if (/^[\d]{1,32}![\d]+$/.test(msg)) {
            this.incomingPing(pk, msg);
        }
        else {
            this.incomingMessage(pk, msg);
        }
    }
    incomingPing(fromPublicKey, msg) {
        const [_d, _h] = msg.split('!');
        const dt = Number(_d);
        const _n = Date.now();
        const _s = this.mapPingSeq.get(fromPublicKey) || 0;
        const _f = this.server.config.network_p2p_interval_ms * (Math.floor(this.arrayBroadcast.length / 3) + 1);
        if (_s > _n - _f || _s >= dt) {
            return;
        }
        this.mapPingSeq.set(fromPublicKey, dt);
        const h = Number(_h);
        const diff = this.server.getBlockchain().getHeight() - h;
        if (diff > 0) {
            logger_1.Logger.trace(`${this.server.config.port} / ${this.publicKey}: Send SYNC to ${fromPublicKey} - Diff: ${diff}`);
            for (let hsync = h + 1; hsync <= this.server.getBlockchain().getHeight(); hsync++) {
                (async (_h, toPublicKey) => {
                    const b = (await this.server.getBlockchain().getRange(_h))[0];
                    const buf = Buffer.from(new sync_1.Sync().create(this.server.getWallet(), b).pack());
                    this.samUDP.send(this.server.getBlockchain().getPeer(toPublicKey).udp, buf);
                })(hsync, fromPublicKey);
                if (hsync - h > this.server.config.network_sync_size) {
                    break;
                }
            }
            return;
        }
        let a = this.mapAvailability.get(fromPublicKey) || [];
        a.push(dt);
        if (a.length === config_1.STAKE_PING_SAMPLE_SIZE) {
            const qc = util_1.Util.QuartileCoeff(a);
            if (qc >= config_1.STAKE_PING_QUARTILE_COEFF_MIN && qc <= config_1.STAKE_PING_QUARTILE_COEFF_MAX) {
                this.server.proposeModifyStake(fromPublicKey, config_1.STAKE_PING_IDENT, config_1.STAKE_PING_AMOUNT);
            }
            a = a.slice(-1 * Math.floor((a.length / 3) * 2));
        }
        this.mapAvailability.set(fromPublicKey, a);
    }
    incomingMessage(fromPublicKey, msg) {
        const m = new message_1.Message(msg);
        if (!this.server.getValidation().validateMessage(m)) {
            return;
        }
        if ((this.mapMsgSeq.get([m.type(), m.origin()].join()) || 0) >= m.seq()) {
            return;
        }
        this.mapMsgSeq.set([m.type(), m.origin()].join(), m.seq());
        this._onMessage(m);
        fromPublicKey === m.origin() && this.broadcast(m, fromPublicKey);
    }
    p2pNetwork() {
        const aNetwork = [...this.server.getBlockchain().getMapPeer().values()];
        const tTimeout = this.server.config.network_p2p_interval_ms;
        this.timeoutP2P = setTimeout(() => {
            this.p2pNetwork();
        }, tTimeout);
        if (aNetwork.length < 2 || !Object.keys(this.samForward).length || !Object.keys(this.samUDP).length) {
            return;
        }
        const _i = [...this.server.getBlockchain().getMapPeer().keys()].join('');
        if (this.identNetwork !== _i) {
            this.identNetwork = _i;
            this.arrayNetwork = aNetwork.sort((a, b) => (a.publicKey > b.publicKey ? 1 : -1));
            logger_1.Logger.info('Network updated');
        }
        this.arrayBroadcast = util_1.Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()].filter((pk) => pk !== this.publicKey));
        setTimeout(() => {
            const buf = Buffer.from(Date.now() + '!' + this.server.getBlockchain().getHeight());
            this.arrayBroadcast.slice(0, Math.ceil(this.arrayBroadcast.length / 3)).forEach((pk) => {
                this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
            });
        }, Math.floor(Math.random() * tTimeout * 0.99));
    }
    getArrayNetwork() {
        return this.arrayNetwork;
    }
    broadcast(m, fromPublicKey = '') {
        const buf = Buffer.from(m.pack());
        if (fromPublicKey !== '' && m.dest() !== '') {
            try {
                this.samUDP.send(this.server.getBlockchain().getPeer(m.dest()).udp, buf);
            }
            catch (error) {
                logger_1.Logger.warn(`Network.broadcast() ${error.toString()}`);
            }
        }
        else {
            const o = m.origin();
            this.arrayBroadcast
                .filter((pk) => o !== pk && fromPublicKey !== pk)
                .forEach((pk) => {
                try {
                    this.samUDP.send(this.server.getBlockchain().getPeer(pk).udp, buf);
                }
                catch (error) {
                    logger_1.Logger.warn(`Network.broadcast() ${error.toString()}`);
                }
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
        else if (this.arrayNetwork.length) {
            const aNetwork = util_1.Util.shuffleArray(this.arrayNetwork.filter((v) => v.http !== this.server.config.http));
            let urlApi = '';
            let n = aNetwork.pop();
            while (n) {
                urlApi = `http://${(0, i2p_sam_1.toB32)(n.http)}.b32.i2p/${endpoint}`;
                try {
                    return JSON.parse(await this.fetch(urlApi, timeout));
                }
                catch (error) {
                    logger_1.Logger.warn(`Network.fetchFromApi() ${urlApi} - ${error.toString()}`);
                }
                n = aNetwork.pop();
            }
        }
        else {
            logger_1.Logger.warn('Network unavailable');
        }
        throw new Error('fetchFromApi failed');
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
