"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bootstrap = void 0;
const logger_1 = require("../logger");
const util_1 = require("../chain/util");
const nanoid_1 = require("nanoid");
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const LENGTH_TOKEN = 32;
const WAIT_JOIN_MS = 30000;
const MAX_RETRY_JOIN = 10;
class Bootstrap {
    constructor(server) {
        this.timeoutChallenge = {};
        this.server = server;
        this.mapToken = new Map();
    }
    static make(server) {
        return new Bootstrap(server);
    }
    async syncWithNetwork() {
        logger_1.Logger.trace('Bootstrap: syncWithNetwork()');
        const blockNetwork = await this.server.getNetwork().fetchFromApi('block/latest');
        const blockLocal = this.server.getBlockchain().getLatestBlock();
        if (blockLocal.hash !== blockNetwork.hash) {
            const genesis = await this.server.getNetwork().fetchFromApi('block/genesis');
            await this.server.getBlockchain().reset(genesis);
            let h = 1;
            while (blockNetwork.height > h) {
                const arrayBlocks = await this.server.getNetwork().fetchFromApi('sync/' + (h + 1));
                for (const b of arrayBlocks) {
                    this.server.getBlockchain().add(b);
                }
                h = this.server.getBlockchain().getLatestBlock().height;
            }
        }
        logger_1.Logger.trace('Bootstrap: syncWithNetwork() done');
    }
    async joinNetwork(publicKey) {
        logger_1.Logger.trace('join/' + [this.server.config.http, this.server.config.udp, publicKey].join('/'));
        await this.server
            .getNetwork()
            .fetchFromApi('join/' + [this.server.config.http, this.server.config.udp, publicKey].join('/'));
    }
    join(http, udp, publicKey, r = 0) {
        clearTimeout(this.timeoutChallenge);
        if (!http.length ||
            !udp.length ||
            !/^[A-Za-z0-9_-]{43}$/.test(publicKey) ||
            this.mapToken.has(publicKey) ||
            this.server.getBlockchain().hasPeer(publicKey)) {
            this.mapToken.delete(publicKey);
            return false;
        }
        const token = (0, nanoid_1.nanoid)(LENGTH_TOKEN);
        this.mapToken.set(publicKey, token);
        this.timeoutChallenge = setTimeout(async () => {
            let res = { token: '' };
            try {
                res = await this.server.getNetwork().fetchFromApi(`http://${(0, i2p_sam_1.toB32)(http)}.b32.i2p/challenge/${token}`);
                this.confirm(http, udp, publicKey, res.token);
            }
            catch (error) {
                logger_1.Logger.warn(`Bootstrap.join(): challenging error - ${error.toString()}`);
                if (r < MAX_RETRY_JOIN) {
                    this.mapToken.delete(publicKey);
                    setImmediate(() => {
                        this.join(http, udp, publicKey, r++);
                    });
                }
                else {
                    logger_1.Logger.info(`Bootstrap.join(): max retries to get challenge confirmation reached (${MAX_RETRY_JOIN})`);
                }
            }
        }, WAIT_JOIN_MS);
        return true;
    }
    challenge(token) {
        return token && token.length === LENGTH_TOKEN ? this.server.getWallet().sign(token) : '';
    }
    confirm(http, udp, publicKey, signedToken) {
        const token = this.mapToken.get(publicKey) || '';
        if (!token || !util_1.Util.verifySignature(publicKey, signedToken, token)) {
            throw new Error('Bootstrap.confirm(): Util.verifySignature() failed');
        }
        if (!this.server.stackTx([
            {
                seq: 1,
                command: 'addPeer',
                http: http,
                udp: udp,
                publicKey: publicKey,
            },
        ])) {
            throw new Error('Bootstrap.confirm(): stackTransaction(addPeer) failed');
        }
        this.mapToken.delete(publicKey);
    }
}
exports.Bootstrap = Bootstrap;
