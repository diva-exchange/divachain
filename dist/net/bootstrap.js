"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bootstrap = void 0;
const agent_1 = __importDefault(require("socks-proxy-agent/dist/agent"));
const simple_get_1 = require("simple-get");
const logger_1 = require("../logger");
const util_1 = require("../chain/util");
const nanoid_1 = require("nanoid");
const MAX_RETRY = 10;
const LENGTH_TOKEN = 32;
const MIN_WAIT_JOIN_MS = 15000;
const MAX_WAIT_JOIN_MS = 60000;
class Bootstrap {
    constructor(server) {
        this.arrayNetwork = [];
        this.server = server;
        this.socksProxyAgent = this.server.config.i2p_has_socks
            ? new agent_1.default(`socks://${this.server.config.i2p_socks_host}:${this.server.config.i2p_socks_port}`)
            : false;
        this.mapToken = new Map();
    }
    static async make(server) {
        const b = new Bootstrap(server);
        return await b.init();
    }
    async init() {
        if (this.server.config.bootstrap) {
            logger_1.Logger.info(`Bootstrapping network, using ${this.server.config.bootstrap}`);
            await this.populateNetwork();
        }
        return this;
    }
    async syncWithNetwork() {
        const blockNetwork = await this.fetchFromApi('block/latest');
        const blockLocal = this.server.getBlockchain().getLatestBlock();
        if (blockLocal.hash !== blockNetwork.hash) {
            const genesis = await this.fetchFromApi('block/genesis');
            await this.server.getBlockchain().reset(genesis);
            let h = 1;
            while (blockNetwork.height > h) {
                const arrayBlocks = await this.fetchFromApi('sync/' + (h + 1));
                for (const b of arrayBlocks) {
                    this.server.getBlockchain().add(b);
                }
                h = this.server.getBlockchain().getLatestBlock().height;
            }
        }
    }
    async enterNetwork(publicKey) {
        await this.fetchFromApi('join/' + this.server.config.address + '/' + publicKey);
    }
    join(address, destination, publicKey, t = MIN_WAIT_JOIN_MS) {
        t = Math.floor(t);
        t = t < MIN_WAIT_JOIN_MS ? MIN_WAIT_JOIN_MS : t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t;
        if (!/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
            this.mapToken.has(address) ||
            this.server.getNetwork().hasNetworkAddress(address) ||
            this.server.getNetwork().hasNetworkDestination(destination) ||
            this.server.getNetwork().hasNetworkPeer(publicKey)) {
            return false;
        }
        const token = (0, nanoid_1.nanoid)(LENGTH_TOKEN);
        this.mapToken.set(address, token);
        setTimeout(async () => {
            let res = { token: '' };
            try {
                res = JSON.parse(await this.fetch('http://' + address + '/challenge/' + token));
                this.confirm(address, destination, publicKey, res.token);
            }
            catch (error) {
                logger_1.Logger.warn('Bootstrap.join() failed: ' + JSON.stringify(error));
                this.mapToken.delete(address);
                t = t + MIN_WAIT_JOIN_MS;
                setTimeout(() => {
                    this.join(address, destination, publicKey, t > MAX_WAIT_JOIN_MS ? MAX_WAIT_JOIN_MS : t);
                }, t);
            }
        }, t);
        return true;
    }
    challenge(token) {
        return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
    }
    confirm(address, destination, publicKey, signedToken) {
        const token = this.mapToken.get(address) || '';
        if (!util_1.Util.verifySignature(publicKey, signedToken, token)) {
            throw new Error('Bootstrap.confirm() - Util.verifySignature() failed: ' + signedToken + ' / ' + token);
        }
        if (!this.server.stackTx([
            {
                seq: 1,
                command: 'addPeer',
                address: address,
                destination: destination,
                publicKey: publicKey,
            },
        ])) {
            throw new Error('Bootstrap.confirm() - stackTransaction(addPeer) failed');
        }
        this.mapToken.delete(address);
    }
    async populateNetwork() {
        let r = 0;
        do {
            try {
                this.arrayNetwork = JSON.parse(await this.fetch(this.server.config.bootstrap + '/network')).sort((a, b) => {
                    return a.publicKey > b.publicKey ? 1 : -1;
                });
            }
            catch (error) {
                logger_1.Logger.warn('Bootstrap.populateNetwork() failed: ' + JSON.stringify(error));
                this.arrayNetwork = [];
            }
            r++;
        } while (!this.arrayNetwork.length && r < MAX_RETRY);
        if (!this.arrayNetwork.length) {
            throw new Error('Network not available');
        }
    }
    async fetchFromApi(endpoint) {
        const aNetwork = util_1.Util.shuffleArray(this.arrayNetwork.filter((v) => v.address !== this.server.config.address));
        let urlApi = '';
        do {
            urlApi = 'http://' + aNetwork.pop().api + '/' + endpoint;
            try {
                return JSON.parse(await this.fetch(urlApi));
            }
            catch (error) {
                logger_1.Logger.warn('Bootstrap.fetchFromApi() failed: ' + JSON.stringify(error));
            }
        } while (aNetwork.length);
        throw new Error('Fetch failed: ' + urlApi);
    }
    fetch(url) {
        const options = {
            url: url,
            agent: this.socksProxyAgent,
            timeout: 10000,
            followRedirects: false,
        };
        return new Promise((resolve, reject) => {
            simple_get_1.get.concat(options, (error, res, data) => {
                if (error || res.statusCode !== 200) {
                    reject(error || { url: options.url, statusCode: res.statusCode });
                }
                else {
                    resolve(data.toString());
                }
            });
        });
    }
}
exports.Bootstrap = Bootstrap;
