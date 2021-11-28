"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkSam = void 0;
const logger_1 = require("../logger");
const message_1 = require("./message/message");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const util_1 = require("../chain/util");
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const events_1 = __importDefault(require("events"));
const config_1 = require("../config");
const sync_1 = require("./message/sync");
class NetworkSam extends events_1.default {
    constructor(server, onMessage) {
        super();
        this.sam = {};
        this.arrayBroadcast = [];
        this.arrayProcessed = [];
        this.timeoutPing = {};
        this.timeoutMorph = {};
        this.server = server;
        const config = this.server.config;
        this.socksProxyAgent = config.i2p_has_socks
            ? new socks_proxy_agent_1.SocksProxyAgent(`socks://${config.i2p_socks_host}:${config.i2p_socks_port}`)
            : undefined;
        this._onMessage = onMessage || false;
        this.publicKey = this.server.getWallet().getPublicKey();
        logger_1.Logger.info(`Network, public key: ${this.publicKey}`);
        let started = false;
        const i = setInterval(() => {
            if (!started && [...this.server.getBlockchain().getMapPeer().keys()].length > 0) {
                logger_1.Logger.info(`P2P starting on ${this.server.config.address}`);
                started = true;
                this.timeoutMorph = setTimeout(async () => {
                    this.sam = await (0, i2p_sam_1.createDatagram)({
                        sam: {
                            host: config.i2p_sam_host,
                            portTCP: config.i2p_sam_port_tcp,
                            portUDP: config.i2p_sam_port_udp,
                            publicKey: config.i2p_public_key,
                            privateKey: config.i2p_private_key,
                        },
                        listen: {
                            address: config.i2p_sam_listen_address,
                            port: config.i2p_sam_listen_port,
                            hostForward: config.i2p_sam_listen_forward_host,
                            portForward: config.i2p_sam_listen_forward_port,
                            onMessage: async (b, fromDestination) => {
                                if (this.hasNetworkDestination(fromDestination) && this.arrayBroadcast.length > 0) {
                                    if (/^[\d]+$/.test(b.toString())) {
                                        const height = Number(b.toString());
                                        if (height < this.server.getBlockchain().getHeight()) {
                                            console.debug(`syncing: ${height + 1}`);
                                            const m = new sync_1.Sync().create((await this.server.getBlockchain().getRange(height + 1, height + 1))[0]);
                                            this.broadcast(m);
                                        }
                                    }
                                    else {
                                        this.processMessage(b);
                                    }
                                }
                            },
                        },
                    });
                    logger_1.Logger.info(`SAM connection established ${config.i2p_sam_host}`);
                    this.morphPeerNetwork();
                    this.ping();
                }, 1);
            }
            if (this.arrayBroadcast.length > config.network_size / 2) {
                logger_1.Logger.info(`P2P ready on ${this.server.config.address}`);
                this.emit('ready');
                clearInterval(i);
            }
        }, 250);
    }
    static make(server, onMessage) {
        return new NetworkSam(server, onMessage);
    }
    shutdown() {
        clearTimeout(this.timeoutPing);
        clearTimeout(this.timeoutMorph);
        this.emit('close');
    }
    network() {
        return {
            network: [...this.server.getBlockchain().getMapPeer()].map((v) => {
                return { publicKey: v[0], address: v[1].address, destination: v[1].destination, stake: v[1].stake };
            }),
            broadcast: this.arrayBroadcast,
        };
    }
    hasNetworkPeer(publicKey) {
        return this.server.getBlockchain().getMapPeer().has(publicKey);
    }
    hasNetworkAddress(address) {
        for (const v of [...this.server.getBlockchain().getMapPeer()]) {
            if (v[1].address === address) {
                return true;
            }
        }
        return false;
    }
    hasNetworkDestination(destination) {
        for (const v of [...this.server.getBlockchain().getMapPeer()]) {
            if (v[1].destination === destination) {
                return true;
            }
        }
        return false;
    }
    processMessage(message) {
        const m = new message_1.Message(message);
        if (this.server.config.network_verbose_logging) {
            const _l = `-> ${this.server.getWallet().getPublicKey()}:`;
            logger_1.Logger.trace(`${_l} ${m.type()} - ${m.ident()}`);
        }
        if (this.arrayProcessed.includes(m.ident())) {
            return;
        }
        if (!this.server.getValidation().validateMessage(m)) {
            return;
        }
        this._onMessage && this._onMessage(m.type(), message);
        this.arrayProcessed.push(m.ident());
    }
    broadcast(m) {
        for (const _pk of this.arrayBroadcast) {
            try {
                this.sam.send(this.server.getBlockchain().getPeer(_pk).destination, Buffer.from(m.pack()));
            }
            catch (error) {
                logger_1.Logger.warn('Network.processMessage() broadcast Error: ' + error.toString());
            }
        }
    }
    morphPeerNetwork() {
        const net = util_1.Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]);
        if (net.length && net.indexOf(this.publicKey) > -1) {
            net.splice(net.indexOf(this.publicKey), 1);
            let t = Math.ceil(this.server.config.network_size * 0.2);
            for (const pk of net) {
                this.arrayBroadcast.indexOf(pk) < 0 && this.arrayBroadcast.push(pk);
                if (this.arrayBroadcast.length > this.server.config.network_size) {
                    this.arrayBroadcast.shift();
                    if (t-- <= 0) {
                        break;
                    }
                }
            }
        }
        this.timeoutMorph = setTimeout(() => {
            this.morphPeerNetwork();
        }, this.server.config.network_morph_interval_ms);
    }
    ping() {
        const net = util_1.Util.shuffleArray([...this.server.getBlockchain().getMapPeer().keys()]);
        const buf = Buffer.from(this.server.getBlockchain().getHeight().toString());
        let t = 0;
        for (const pk of net) {
            setTimeout(() => {
                try {
                    this.sam.send(this.server.getBlockchain().getPeer(pk).destination, buf);
                }
                catch (error) {
                    logger_1.Logger.warn('Network.ping() broadcast Error: ' + error.toString());
                }
            }, Math.ceil(Math.random() * config_1.MIN_NETWORK_PING_INTERVAL_MS));
            if (t++ >= this.server.config.network_size) {
                break;
            }
        }
        this.timeoutPing = setTimeout(() => {
            this.ping();
        }, Math.ceil(Math.random() * config_1.MAX_NETWORK_PING_INTERVAL_MS) + config_1.MIN_NETWORK_PING_INTERVAL_MS);
    }
}
exports.NetworkSam = NetworkSam;
