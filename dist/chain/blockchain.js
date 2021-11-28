"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Blockchain = void 0;
const fs_1 = __importDefault(require("fs"));
const levelup_1 = __importDefault(require("levelup"));
const leveldown_1 = __importDefault(require("leveldown"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
const util_1 = require("./util");
class Blockchain {
    constructor(server) {
        this.height = 0;
        this.mapBlocks = new Map();
        this.latestBlock = {};
        this.mapPeer = new Map();
        this.quorum = 0;
        this.server = server;
        this.publicKey = this.server.getWallet().getPublicKey();
        this.dbBlockchain = (0, levelup_1.default)((0, leveldown_1.default)(path_1.default.join(this.server.config.path_blockstore, this.publicKey)), {
            createIfMissing: true,
            errorIfExists: false,
            compression: true,
            cacheSize: 2 * 1024 * 1024,
        });
        this.dbState = (0, levelup_1.default)((0, leveldown_1.default)(path_1.default.join(this.server.config.path_state, this.publicKey)), {
            createIfMissing: true,
            errorIfExists: false,
            compression: true,
            cacheSize: 2 * 1024 * 1024,
        });
    }
    static async make(server) {
        const b = new Blockchain(server);
        if (server.config.bootstrap) {
            await b.clear();
        }
        else {
            await b.init();
        }
        return b;
    }
    async init() {
        this.height = 0;
        this.mapBlocks = new Map();
        this.latestBlock = {};
        await this.dbState.clear();
        await new Promise((resolve, reject) => {
            this.dbBlockchain
                .createReadStream()
                .on('data', async (data) => {
                const block = JSON.parse(data.value);
                this.updateCache(block);
                await this.processState(block);
            })
                .on('end', resolve)
                .on('error', reject);
        });
    }
    async shutdown() {
        await this.dbBlockchain.close();
        await this.dbState.close();
    }
    async clear() {
        await this.dbBlockchain.clear();
        await this.dbState.clear();
        this.height = 0;
        this.mapBlocks = new Map();
        this.latestBlock = {};
        this.mapPeer = new Map();
    }
    async reset(genesis) {
        await this.clear();
        await this.updateBlockData(String(1).padStart(16, '0'), JSON.stringify(genesis));
        await this.init();
    }
    add(block) {
        if (this.height + 1 !== block.height ||
            block.previousHash !== this.latestBlock.hash ||
            !this.server.getValidation().validateBlock(block)) {
            const l = `${this.publicKey} - failed to verify block ${block.height}: `;
            if (this.height + 1 !== block.height) {
                logger_1.Logger.warn(l + '"Height" check failed');
            }
            else if (block.previousHash !== this.latestBlock.hash) {
                logger_1.Logger.warn(l + '"Previous Hash" check failed');
            }
            else {
                logger_1.Logger.warn(l + '"Validation.validateBlock()" failed');
            }
            return false;
        }
        this.updateCache(block);
        (async (b) => {
            await this.updateBlockData(String(b.height).padStart(16, '0'), JSON.stringify(b));
            await this.processState(b);
        })(block);
        return true;
    }
    updateCache(block) {
        this.height = block.height;
        this.latestBlock = block;
        this.mapBlocks.set(this.height, block);
        if (this.mapBlocks.size > this.server.config.blockchain_max_blocks_in_memory) {
            this.mapBlocks.delete(this.height - this.server.config.blockchain_max_blocks_in_memory);
        }
    }
    async getRange(gte, lte) {
        if (gte < 1) {
            throw new Error('Blockchain.getRange(): invalid range');
        }
        lte = Math.floor(lte < 1 ? this.height : lte);
        gte = gte <= this.height ? Math.floor(gte) : this.height;
        lte = lte <= this.height ? lte : this.height;
        gte = lte - gte > 0 ? gte : lte;
        gte = lte - gte >= this.server.config.api_max_query_size ? lte - this.server.config.api_max_query_size + 1 : gte;
        if (this.mapBlocks.has(gte) && this.mapBlocks.has(lte)) {
            const start = this.mapBlocks.size - this.height + gte - 1;
            const end = start + lte - gte + 1;
            return [...this.mapBlocks.values()].slice(start, end);
        }
        const a = [];
        return new Promise((resolve, reject) => {
            this.dbBlockchain
                .createValueStream({ gte: String(gte).padStart(16, '0'), lte: String(lte).padStart(16, '0') })
                .on('data', (data) => {
                a.push(JSON.parse(data));
            })
                .on('end', () => {
                resolve(a);
            })
                .on('error', reject);
        });
    }
    async getPage(page, size) {
        page = page < 1 ? 1 : Math.floor(page);
        size =
            size < 1 || size > this.server.config.api_max_query_size
                ? this.server.config.api_max_query_size
                : Math.floor(size);
        size = size > this.height ? this.height : size;
        const lte = this.height - (page - 1) * size < 1 ? size : this.height - (page - 1) * size;
        const gte = lte - size + 1;
        return this.getRange(gte, lte);
    }
    async getTransaction(origin, ident) {
        return new Promise((resolve, reject) => {
            for (const b of [...this.mapBlocks.values()]) {
                const t = b.tx.find((t) => t.origin === origin && t.ident === ident);
                if (t) {
                    return resolve({ height: b.height, transaction: t });
                }
            }
            let b = {};
            let t = {};
            this.dbBlockchain
                .createValueStream()
                .on('data', (data) => {
                if (!t.origin) {
                    b = JSON.parse(data);
                    t =
                        b.tx.find((t) => t.origin === origin && t.ident === ident) ||
                            {};
                }
            })
                .on('end', () => {
                t.origin ? resolve({ height: b.height, transaction: t }) : reject(new Error('Not Found'));
            })
                .on('error', reject);
        });
    }
    async getState(key) {
        return new Promise((resolve, reject) => {
            if (!key.length) {
                const a = [];
                this.dbState
                    .createReadStream()
                    .on('data', (data) => {
                    a.push({ key: data.key.toString(), value: data.value.toString() });
                    if (a.length === this.server.config.api_max_query_size) {
                        return resolve(a);
                    }
                })
                    .on('end', () => {
                    resolve(a);
                })
                    .on('error', (e) => {
                    reject(e);
                });
            }
            else {
                this.dbState.get(key, (error, value) => {
                    error ? reject(error) : resolve([{ key: key, value: value.toString() }]);
                });
            }
        });
    }
    getLatestBlock() {
        return this.latestBlock;
    }
    getHeight() {
        return this.height;
    }
    getStake(publicKey) {
        return this.mapPeer.has(publicKey) ? this.mapPeer.get(publicKey).stake : 0;
    }
    getQuorum() {
        if (this.quorum <= 0) {
            throw new Error('Invalid network quorum');
        }
        return (2 * this.quorum) / 3;
    }
    getMapPeer() {
        return this.mapPeer;
    }
    getPeer(publicKey) {
        return this.mapPeer.get(publicKey);
    }
    async getPerformance(height) {
        let ts;
        try {
            ts = Number((await this.dbState.get('debug-performance-' + height)).toString());
        }
        catch (error) {
            ts = 0;
        }
        return { timestamp: ts };
    }
    static genesis(p) {
        if (!fs_1.default.existsSync(p)) {
            throw new Error('Genesis Block not found at: ' + p);
        }
        const b = JSON.parse(fs_1.default.readFileSync(p).toString());
        b.hash = util_1.Util.hash(b.previousHash + b.version + b.height + JSON.stringify(b.tx));
        return b;
    }
    async processState(block) {
        if (this.server.config.debug_performance) {
            await this.updateStateData('debug-performance-' + this.height, new Date().getTime());
        }
        for (const t of block.tx) {
            for (const c of t.commands) {
                switch (c.command) {
                    case Blockchain.COMMAND_ADD_PEER:
                        await this.addPeer(c);
                        break;
                    case Blockchain.COMMAND_REMOVE_PEER:
                        await this.removePeer(c);
                        break;
                    case Blockchain.COMMAND_MODIFY_STAKE:
                        await this.modifyStake(c);
                        break;
                    case Blockchain.COMMAND_DATA:
                        await this.updateStateData(c.ns + ':' + t.origin, c.base64url);
                        break;
                    case Blockchain.COMMAND_DECISION:
                        await this.setDecision(c.ns, t.origin);
                        break;
                }
            }
        }
    }
    async addPeer(command) {
        if (this.mapPeer.has(command.publicKey)) {
            return;
        }
        const peer = {
            publicKey: command.publicKey,
            address: command.address,
            destination: command.destination,
            stake: 0,
        };
        this.mapPeer.set(command.publicKey, peer);
        await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake);
    }
    async removePeer(command) {
        if (this.mapPeer.has(command.publicKey)) {
            const peer = this.mapPeer.get(command.publicKey);
            this.quorum = this.quorum - peer.stake;
            this.mapPeer.delete(command.publicKey);
            await this.dbState.del(Blockchain.STATE_PEER_IDENT + command.publicKey);
        }
    }
    async modifyStake(command) {
        if (this.mapPeer.has(command.publicKey)) {
            const peer = this.mapPeer.get(command.publicKey);
            if (peer.stake + command.stake < 0) {
                command.stake = -1 * peer.stake;
            }
            this.quorum = this.quorum + command.stake;
            peer.stake = peer.stake + command.stake;
            this.mapPeer.set(command.publicKey, peer);
            await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake);
        }
    }
    async setDecision(ns, origin) {
        const key = Blockchain.STATE_DECISION_IDENT + ns;
        let objOriginStake;
        try {
            const v = (await this.getState(key))[0].value;
            if (v === Blockchain.STATE_DECISION_TAKEN) {
                return;
            }
            objOriginStake = JSON.parse(v);
        }
        catch (error) {
            objOriginStake = {};
        }
        if (!objOriginStake[origin]) {
            objOriginStake[origin] = this.getStake(origin);
            await this.updateStateData(key, JSON.stringify(objOriginStake));
            if (this.getQuorum() <= Object.values(objOriginStake).reduce((a, b) => a + b, 0)) {
                await this.updateStateData(key, Blockchain.STATE_DECISION_TAKEN);
            }
        }
    }
    async updateBlockData(key, value) {
        try {
            await this.dbBlockchain.put(key, value);
        }
        catch (error) {
            logger_1.Logger.warn('Blockchain.updateBlockData() failed: ' + JSON.stringify(error));
        }
    }
    async updateStateData(key, value) {
        try {
            await this.dbState.put(key, value);
        }
        catch (error) {
            logger_1.Logger.warn('Blockchain.updateStateData() failed: ' + JSON.stringify(error));
        }
    }
}
exports.Blockchain = Blockchain;
Blockchain.COMMAND_ADD_PEER = 'addPeer';
Blockchain.COMMAND_REMOVE_PEER = 'removePeer';
Blockchain.COMMAND_MODIFY_STAKE = 'modifyStake';
Blockchain.COMMAND_DATA = 'data';
Blockchain.COMMAND_DECISION = 'decision';
Blockchain.STATE_DECISION_IDENT = 'decision:';
Blockchain.STATE_PEER_IDENT = 'peer:';
Blockchain.STATE_DECISION_TAKEN = 'taken';
