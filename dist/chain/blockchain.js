"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Blockchain = void 0;
const fs_1 = __importDefault(require("fs"));
const level_1 = require("level");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
const util_1 = require("./util");
const config_1 = require("../config");
class Blockchain {
    constructor(server) {
        this.height = 0;
        this.mapBlocks = new Map();
        this.latestBlock = {};
        this.mapPeer = new Map();
        this.mapHttp = new Map();
        this.mapUdp = new Map();
        this.quorumWeighted = 0;
        this.quorum = 0;
        this.mapModifyStake = new Map();
        this.mapVoteStake = new Map();
        this.arrayDecision = {};
        this.arrayTakenDecision = {};
        this.server = server;
        this.publicKey = this.server.getWallet().getPublicKey();
        this.dbBlockchain = new level_1.Level(path_1.default.join(this.server.config.path_blockstore, this.publicKey), {
            createIfMissing: true,
            errorIfExists: false,
            compression: true,
            cacheSize: 2 * 1024 * 1024,
        });
        this.dbState = new level_1.Level(path_1.default.join(this.server.config.path_state, this.publicKey), {
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
        for await (const value of this.dbBlockchain.values()) {
            const block = JSON.parse(value);
            this.updateCache(block);
            await this.processState(block);
        }
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
        block.votes.forEach((v) => {
            this.hasPeer(v.origin) && this.mapVoteStake.set(v.origin, (this.mapVoteStake.get(v.origin) || 0) + 1);
        });
        if (this.mapVoteStake.size > 0) {
            if ((block.hash.match(new RegExp(block.hash.charAt(block.height % block.hash.length), 'g')) || []).length >=
                config_1.STAKE_VOTE_MATCH_THRESHOLD) {
                const vs = [...this.mapVoteStake.entries()].filter((a) => {
                    return a[0] !== this.publicKey;
                });
                vs.sort((a, b) => (a[1] > b[1] ? -1 : a[1] === b[1] && a[0] > b[0] ? -1 : 1));
                if (this.server.proposeModifyStake(vs[0][0], config_1.STAKE_VOTE_IDENT, config_1.STAKE_VOTE_AMOUNT)) {
                    this.mapVoteStake.delete(vs[0][0]);
                }
            }
        }
    }
    async getRange(gte, lte = -1) {
        gte = gte <= this.height ? (gte < 1 ? 1 : Math.floor(gte)) : this.height;
        lte = lte < 0 ? gte : Math.floor(lte < 1 ? this.height : lte);
        lte = lte <= this.height ? lte : this.height;
        gte = lte - gte > 0 ? gte : lte;
        gte = lte - gte >= this.server.config.api_max_query_size ? lte - this.server.config.api_max_query_size + 1 : gte;
        if (this.mapBlocks.has(gte) && this.mapBlocks.has(lte)) {
            const start = this.mapBlocks.size - this.height + gte - 1;
            const end = start + lte - gte + 1;
            return [...this.mapBlocks.values()].slice(start, end);
        }
        const a = [];
        for await (const value of this.dbBlockchain.values({
            gte: String(gte).padStart(16, '0'),
            lte: String(lte).padStart(16, '0'),
        })) {
            a.push(JSON.parse(value));
        }
        return a;
    }
    async getPage(page, size) {
        page = page < 1 ? 1 : Math.floor(page);
        size =
            size < 1 || size > this.server.config.api_max_query_size
                ? this.server.config.api_max_query_size
                : Math.floor(size);
        let gte = this.height - page * size + 1;
        gte = gte < 1 ? 1 : gte;
        return this.getRange(gte, gte + size - 1);
    }
    async searchBlocks(search = '') {
        const a = [];
        for await (const value of this.dbBlockchain.values({
            reverse: true,
            limit: this.server.config.api_max_query_size,
        })) {
            (!search.length || value.indexOf(search) > -1) && a.push(JSON.parse(value));
        }
        return a.reverse();
    }
    async getTransaction(origin, ident) {
        for await (const b of [...this.mapBlocks.values()]) {
            const t = b.tx.find((t) => t.origin === origin && t.ident === ident);
            if (t) {
                return { height: b.height, transaction: t };
            }
        }
        for await (const value of this.dbBlockchain.values()) {
            const b = JSON.parse(value);
            const t = b.tx.find((t) => t.origin === origin && t.ident === ident);
            if (t) {
                return { height: b.height, transaction: t };
            }
        }
        throw new Error('Not Found');
    }
    async getState(key) {
        return new Promise((resolve) => {
            this.dbState.get(key, (error, value) => {
                error ? resolve(false) : resolve({ key: key, value: value.toString() });
            });
        });
    }
    async searchState(search = '') {
        const a = [];
        for await (const [key, value] of this.dbState.iterator({
            reverse: true,
            limit: this.server.config.api_max_query_size,
        })) {
            (!search.length || (key + value).indexOf(search) > -1) && a.push({ key: key, value: value });
        }
        return a;
    }
    getLatestBlock() {
        return this.latestBlock;
    }
    getHeight() {
        return this.height;
    }
    getStake(publicKey) {
        try {
            return this.getPeer(publicKey).stake;
        }
        catch (error) {
            return 0;
        }
    }
    getQuorum() {
        if (this.quorum <= 0) {
            throw new Error('Invalid quorum');
        }
        return this.quorum * (2 / 3);
    }
    getQuorumWeighted() {
        if (this.quorumWeighted <= 0) {
            throw new Error('Invalid weighted quorum');
        }
        return this.quorumWeighted * 0.5;
    }
    getMapPeer() {
        return this.mapPeer;
    }
    hasPeer(publicKey) {
        return this.mapPeer.has(publicKey);
    }
    getPeer(publicKey) {
        return this.mapPeer.get(publicKey);
    }
    getPublicKeyByUdp(udp) {
        return this.mapUdp.get(udp) || '';
    }
    hasNetworkHttp(http) {
        return this.mapHttp.has(http);
    }
    isDecisionTaken(c) {
        return Object.values(this.arrayTakenDecision)
            .flat()
            .some((o) => o.ns === c.ns);
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
        b.hash = util_1.Util.hash([b.version, b.previousHash, JSON.stringify(b.tx), b.height].join());
        return b;
    }
    async processState(block) {
        if (this.server.config.debug_performance) {
            await this.updateStateData('debug-performance-' + this.height, new Date().getTime().toString());
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
                        await this.modifyStake(t.origin, c);
                        break;
                    case Blockchain.COMMAND_DATA:
                        await this.updateStateData(c.ns + ':' + t.origin, c.d);
                        break;
                    case Blockchain.COMMAND_DECISION:
                        this.isDecisionTaken(c) &&
                            (await this.updateStateData(c.ns, JSON.stringify({ h: c.h, d: c.d })));
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
            http: command.http,
            udp: command.udp,
            stake: 1,
        };
        this.quorum++;
        this.mapPeer.set(command.publicKey, peer);
        this.mapHttp.set(peer.http, command.publicKey);
        this.mapUdp.set(peer.udp, command.publicKey);
        await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake.toString());
    }
    async removePeer(command) {
        if (!this.mapPeer.has(command.publicKey)) {
            return;
        }
        const peer = this.mapPeer.get(command.publicKey);
        this.quorumWeighted = this.quorumWeighted - peer.stake;
        this.quorum--;
        this.mapPeer.delete(command.publicKey);
        this.mapHttp.delete(peer.http);
        this.mapUdp.delete(peer.udp);
        await this.deleteStateData(Blockchain.STATE_PEER_IDENT + command.publicKey);
    }
    async modifyStake(origin, command) {
        if (!this.mapPeer.has(command.publicKey) || command.publicKey === origin) {
            return;
        }
        command.publicKey === this.publicKey && this.server.incStakeCredit(origin);
        const i = [command.publicKey, command.ident, command.stake].join('');
        const a = this.mapModifyStake.get(i) || [];
        if (a.includes(origin)) {
            return;
        }
        a.push(origin);
        this.mapModifyStake.set(i, a);
        if (a.length < this.getQuorum()) {
            return;
        }
        this.mapModifyStake.delete(i);
        const peer = this.mapPeer.get(command.publicKey);
        if (peer.stake + command.stake < 1) {
            command.stake = -1 * peer.stake;
        }
        this.quorumWeighted = this.quorumWeighted + command.stake;
        peer.stake = peer.stake + command.stake;
        this.mapPeer.set(command.publicKey, peer);
        await this.updateStateData(Blockchain.STATE_PEER_IDENT + command.publicKey, peer.stake.toString());
    }
    async updateBlockData(key, data) {
        try {
            await this.dbBlockchain.put(key, data);
        }
        catch (error) {
            logger_1.Logger.warn(`Blockchain.updateBlockData() ${error.toString()}`);
        }
    }
    async updateStateData(key, value) {
        try {
            await this.dbState.put(key, value);
        }
        catch (error) {
            logger_1.Logger.warn(`Blockchain.updateStateData() ${error.toString()}`);
        }
    }
    async deleteStateData(key) {
        try {
            await this.dbState.del(key);
        }
        catch (error) {
            logger_1.Logger.warn(`Blockchain.updateStateData() ${error.toString()}`);
        }
    }
}
exports.Blockchain = Blockchain;
Blockchain.COMMAND_ADD_PEER = 'addPeer';
Blockchain.COMMAND_REMOVE_PEER = 'removePeer';
Blockchain.COMMAND_MODIFY_STAKE = 'modifyStake';
Blockchain.COMMAND_DATA = 'data';
Blockchain.COMMAND_DECISION = 'decision';
Blockchain.STATE_PEER_IDENT = 'peer:';
