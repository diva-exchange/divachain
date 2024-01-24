/**
 * Copyright (C) 2022-2024 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */
import fs from 'fs';
import { Level } from 'level';
import path from 'path';
import { Logger } from '../logger.js';
import { Util } from './util.js';
export class Chain {
    static COMMAND_ADD_PEER = 'addPeer';
    static COMMAND_REMOVE_PEER = 'removePeer';
    static COMMAND_MODIFY_STAKE = 'modifyStake';
    static COMMAND_DATA = 'data';
    server;
    publicKey;
    mapDbChain;
    dbState;
    dbPeer;
    mapHeight; // origin -> height
    mapTxs; // origin -> height
    mapLatestTx;
    mapLock = new Map();
    mapPeer;
    mapHttp;
    mapTcp;
    mapUdp;
    countNodes;
    stakeNodes;
    static async make(server) {
        const c = new Chain(server);
        if (server.config.bootstrap) {
            await c.clear();
        }
        else {
            await c.init();
        }
        return c;
    }
    constructor(server) {
        this.server = server;
        this.publicKey = this.server.getWallet().getPublicKey();
        this.mapDbChain = new Map();
        const pathDbState = path.join(this.server.config.path_state, this.publicKey);
        this.dbState = new Level(pathDbState, { valueEncoding: 'utf8', createIfMissing: true, errorIfExists: false });
        const pathDbPeer = path.join(this.server.config.path_state, this.publicKey + '-peer');
        this.dbPeer = new Level(pathDbPeer, { valueEncoding: 'json', createIfMissing: true, errorIfExists: false });
        this.mapHeight = new Map();
        this.mapTxs = new Map();
        this.mapLatestTx = new Map();
        this.mapPeer = new Map();
        this.mapHttp = new Map();
        this.mapTcp = new Map();
        this.mapUdp = new Map();
        this.countNodes = 0;
        this.stakeNodes = 0;
    }
    async init() {
        const aPeer = await this.dbPeer.values().all();
        //@FIXME if the Peer database is corrupted (or deleted, or whatever)... the local data gets dumped!
        if (!aPeer.length) {
            await this.reset();
        }
        // load peers
        for (const commandAddPeer of aPeer) {
            try {
                await this.addPeer(commandAddPeer);
            }
            catch (error) {
                Logger.warn(`${this.server.config.port}: init/addPeer failed - ${commandAddPeer}`);
            }
        }
        await this.dbState.clear();
        for (const db of this.mapDbChain.values()) {
            for await (const value of db.values()) {
                const tx = value;
                this.updateCache(tx);
                await this.processState(tx);
            }
        }
    }
    async reset() {
        for (const [origin, db] of this.mapDbChain.entries()) {
            await db.clear();
            await db.close();
            this.mapDbChain.delete(origin);
        }
        const pathDb = path.join(this.server.config.path_chain, this.publicKey, this.publicKey);
        const dbChain = new Level(pathDb, {
            valueEncoding: 'json',
            createIfMissing: true,
            errorIfExists: false,
        });
        const genesis = Chain.genesis(this.server.config.path_genesis);
        genesis.origin = this.publicKey;
        await dbChain.put(String(genesis.height).padStart(16, '0'), genesis);
        await dbChain.close();
        this.updateCache(genesis);
        await this.processState(genesis);
    }
    async shutdown() {
        try {
            for (const db of this.mapDbChain.values()) {
                await db.close();
            }
            await this.dbState.close();
            await this.dbPeer.close();
        }
        catch (error) {
            //@FIXME error handling
            console.debug(error);
            return;
        }
    }
    async clear() {
        for (const db of this.mapDbChain.values()) {
            await db.clear();
        }
        await this.dbState.clear();
        await this.dbPeer.clear();
        this.mapHeight = new Map();
        this.mapTxs = new Map();
        this.mapLatestTx = new Map();
        this.mapPeer = new Map();
    }
    async add(tx) {
        //@TODO validation here?
        if (!this.mapPeer.has(tx.origin)) {
            throw new Error(`Unknown peer: ${tx.origin}`);
        }
        if (this.mapLock.has(tx.origin)) {
            throw new Error(`Locked Chain: ${tx.origin} #${tx.height}`);
        }
        this.mapLock.set(tx.origin, tx.height);
        const dbChain = this.mapDbChain.get(tx.origin);
        if (dbChain) {
            await dbChain.put(String(tx.height).padStart(16, '0'), tx);
            this.updateCache(tx);
            await this.processState(tx);
        }
        this.mapLock.delete(tx.origin);
    }
    updateCache(tx) {
        this.mapHeight.set(tx.origin, tx.height);
        this.mapLatestTx.set(tx.origin, tx);
        // cache
        const mT = this.mapTxs.get(tx.origin) || new Map();
        mT.set(tx.height, tx);
        if (mT.size > this.server.config.chain_max_txs_in_memory) {
            mT.delete(tx.height - this.server.config.chain_max_txs_in_memory);
        }
        this.mapTxs.set(tx.origin, mT);
    }
    async getRange(gte, lte, origin) {
        const height = this.mapHeight.get(origin);
        const mT = this.mapTxs.get(origin);
        const db = this.mapDbChain.get(origin);
        if (!height || !mT || !db) {
            return;
        }
        if (gte > height) {
            return [];
        }
        gte = gte < 1 ? 1 : Math.floor(gte);
        lte = lte < 0 ? gte : Math.floor(lte < 1 ? height : lte);
        lte = lte <= height ? lte : height;
        gte = lte - gte > 0 ? gte : lte;
        gte = lte - gte >= this.server.config.api_max_query_size ? lte - this.server.config.api_max_query_size + 1 : gte;
        // cache available?
        if (mT.has(gte) && mT.has(lte)) {
            const start = mT.size - height + gte - 1;
            const end = start + lte - gte + 1;
            return [...mT.values()].slice(start, end);
        }
        const a = [];
        for await (const value of db.values({
            gte: String(gte).padStart(16, '0'),
            lte: String(lte).padStart(16, '0'),
        })) {
            a.push(value);
        }
        return a;
    }
    async getPage(page, size, origin) {
        const height = this.mapHeight.get(origin);
        if (!height) {
            return;
        }
        page = page < 1 ? 1 : Math.floor(page);
        size =
            size < 1 || size > this.server.config.api_max_query_size
                ? this.server.config.api_max_query_size
                : Math.floor(size);
        let gte = height - page * size + 1;
        if (gte + size - 1 < 1) {
            return [];
        }
        gte = gte < 1 ? 1 : gte;
        return this.getRange(gte, gte + size - 1, origin);
    }
    async search(q, origin) {
        // support only search strings with more than 2 characters
        const db = this.mapDbChain.get(origin);
        if (q.length < 3 || !db) {
            return;
        }
        const a = [];
        for await (const value of db.values({
            reverse: true,
            limit: this.server.config.api_max_query_size,
        })) {
            try {
                JSON.stringify(value).indexOf(q) > -1 && a.push(value);
            }
            catch (e) {
                Logger.warn(`${this.server.config.port}: ${e}`);
            }
        }
        return a.reverse();
    }
    async getTx(height, origin) {
        const mT = this.mapTxs.get(origin);
        const db = this.mapDbChain.get(origin);
        if (!mT || !db) {
            return;
        }
        try {
            // cache or db
            return mT.get(height) || (await db.get(String(height).padStart(16, '0')));
        }
        catch (error) {
            return;
        }
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
    // get latest local tx
    getLatestTx(origin) {
        return this.mapLatestTx.get(origin);
    }
    getHeight(origin) {
        return this.mapHeight.get(origin);
    }
    hasQuorum(size) {
        return size > this.countNodes * (2 / 3);
    }
    getMapPeer() {
        return this.mapPeer;
    }
    getListPeer() {
        return [...this.mapPeer.keys()].sort();
    }
    hasPeer(publicKey) {
        return this.mapPeer.has(publicKey);
    }
    getPeer(publicKey) {
        return this.mapPeer.get(publicKey);
    }
    hasNetworkHttp(http) {
        return this.mapHttp.has(http);
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
        if (!fs.existsSync(p)) {
            throw new Error('Genesis Tx not found at: ' + p);
        }
        const tx = JSON.parse(fs.readFileSync(p).toString());
        tx.hash = Util.hash(tx);
        return tx;
    }
    async processState(tx) {
        if (this.server.config.debug_performance) {
            await this.updateStateData(`debug-performance-${tx.origin}-${tx.height}`, new Date().getTime().toString());
        }
        for (const c of tx.commands) {
            switch (c.command) {
                case Chain.COMMAND_ADD_PEER:
                    await this.addPeer(c);
                    break;
                case Chain.COMMAND_REMOVE_PEER:
                    await this.removePeer(c);
                    break;
                case Chain.COMMAND_MODIFY_STAKE:
                    //TODO
                    break;
                case Chain.COMMAND_DATA:
                    await this.updateStateData([c.ns, tx.origin].join(':'), c.d);
                    break;
            }
        }
    }
    //@FIXME trust the public key from the command?
    async addPeer(command) {
        if (this.mapPeer.has(command.publicKey)) {
            return;
        }
        const peer = {
            publicKey: command.publicKey,
            http: command.http,
            tcp: command.tcp,
            udp: command.udp,
            stake: 1,
        };
        this.countNodes++;
        this.stakeNodes = this.stakeNodes + peer.stake;
        this.mapPeer.set(command.publicKey, peer);
        this.mapHttp.set(peer.http, command.publicKey);
        this.mapTcp.set(peer.tcp, command.publicKey);
        this.mapUdp.set(peer.udp, command.publicKey);
        await this.dbPeer.put(command.publicKey, command);
        const pathDb = path.join(this.server.config.path_chain, this.publicKey, command.publicKey);
        const dbChain = new Level(pathDb, {
            valueEncoding: 'json',
            createIfMissing: true,
            errorIfExists: false,
        });
        // load genesis
        const genesis = Chain.genesis(this.server.config.path_genesis);
        genesis.origin = command.publicKey;
        await dbChain.put(String(genesis.height).padStart(16, '0'), genesis);
        this.mapDbChain.set(command.publicKey, dbChain);
    }
    //@FIXME trust the public key from the command?
    async removePeer(command) {
        // can't remove yourself
        if (command.publicKey === this.publicKey) {
            return;
        }
        if (!this.mapPeer.has(command.publicKey)) {
            return;
        }
        const peer = this.mapPeer.get(command.publicKey);
        this.countNodes--;
        this.stakeNodes = this.stakeNodes - peer.stake;
        this.mapPeer.delete(command.publicKey);
        this.mapHttp.delete(peer.http);
        this.mapTcp.delete(peer.tcp);
        await this.dbPeer.del(command.publicKey);
        this.mapDbChain.delete(command.publicKey);
    }
    async updateStateData(key, value) {
        await this.dbState.put(key, value);
    }
}
//# sourceMappingURL=chain.js.map