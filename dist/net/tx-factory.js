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
import { Tx } from '../chain/tx.js';
import { TxMessage } from './message/tx.js';
import { VoteMessage } from './message/vote.js';
import { Logger } from '../logger.js';
import { Util } from '../chain/util.js';
export class TxFactory {
    server;
    config;
    chain;
    network;
    validation;
    wallet;
    stackTransaction = [];
    mapStatus = new Map();
    ownTx = {};
    mapTx = new Map(); // hash -> TxStruct
    static make(server) {
        return new TxFactory(server);
    }
    constructor(server) {
        this.server = server;
        this.config = server.config;
        this.chain = server.getChain();
        this.network = server.getNetwork();
        this.validation = server.getValidation();
        this.wallet = server.getWallet();
    }
    shutdown() {
        //@TODO cleanup
    }
    stack(commands) {
        //@FIXME logging
        Logger.trace(`${this.config.port}: Stacking TX...`);
        if (this.stackTransaction.push({ commands: commands })) {
            return this.createOwnTx();
        }
        return false;
    }
    getStack() {
        return this.stackTransaction;
    }
    createOwnTx() {
        if (this.ownTx.height) {
            return true;
        }
        const me = this.wallet.getPublicKey();
        const prevTx = this.chain.getLatestTx(me);
        if (!this.stackTransaction.length || !prevTx) {
            return false;
        }
        const r = this.stackTransaction.shift();
        try {
            const tx = new Tx(this.wallet, prevTx, r.commands).get();
            this.validation.validateTx(tx);
            this.ownTx = tx;
        }
        catch (e) {
            Logger.warn(`${this.config.port}: local TX validation failed ${e}`);
            return false;
        }
        this.mapTx.set(this.ownTx.hash, this.ownTx);
        // broadcast ownTx
        this.broadcastTx(this.ownTx);
        //@FIXME logging
        Logger.trace(`${this.config.port}: TX created on ${me} #${this.chain.getListPeer().indexOf(me)}`);
        return true;
    }
    processTx(tx) {
        const structTx = tx.tx();
        const prevTx = this.chain.getLatestTx(structTx.origin);
        // not interested
        if (!prevTx || prevTx.height + 1 !== structTx.height || prevTx.hash !== structTx.prev) {
            return;
        }
        // check hash
        if (structTx.hash !== Util.hash(structTx)) {
            //@FIXME serious breach
            Logger.trace(`${this.config.port}: TX invalid hash`);
            return;
        }
        // check existing vote from origin
        if (!structTx.votes.some((v) => {
            return v.origin === structTx.origin;
        })) {
            //@FIXME serious breach
            Logger.trace(`${this.config.port}: TX missing vote from origin`);
            return;
        }
        // check all votes (signatures)
        if (!structTx.votes.every((v) => {
            return Util.verifySignature(v.origin, v.sig, structTx.hash);
        })) {
            //@FIXME serious breach
            Logger.trace(`${this.config.port}: TX invalid votes`);
            return;
        }
        //@TODO stateful? Reason to add own vote?
        const me = this.wallet.getPublicKey();
        if (!structTx.votes.some((v) => {
            return v.origin === me;
        })) {
            structTx.votes = structTx.votes.concat({ origin: me, sig: this.wallet.sign(structTx.hash) });
            this.mapTx.set(structTx.hash, structTx);
            // new valid tx?
            if (this.chain.hasQuorum(structTx.votes.length)) {
                (async () => {
                    await this.addTx(structTx);
                })();
            }
            else {
                const struct = { hash: structTx.hash, votes: structTx.votes };
                this.network.broadcast(new VoteMessage(struct, me).asString(this.wallet));
            }
        }
    }
    processVote(vote) {
        const structTx = this.mapTx.get(vote.hash());
        // not interested
        if (!structTx) {
            return;
        }
        // new votes?
        const aV = vote.votes().filter((v) => {
            return (!structTx.votes.some((vO) => {
                return vO.origin === v.origin;
            }) && Util.verifySignature(v.origin, v.sig, structTx.hash));
        });
        if (!aV.length) {
            return;
        }
        structTx.votes = structTx.votes.concat(aV);
        this.mapTx.set(vote.hash(), structTx);
        // new valid tx?
        if (this.chain.hasQuorum(structTx.votes.length)) {
            (async () => {
                await this.addTx(structTx);
            })();
        }
        else {
            const me = this.wallet.getPublicKey();
            const struct = { hash: structTx.hash, votes: structTx.votes };
            this.network.broadcast(new VoteMessage(struct, me).asString(this.wallet));
        }
    }
    processStatus(status) {
        const me = this.wallet.getPublicKey();
        (async () => {
            for await (const r of status.matrix()) {
                let height = this.chain.getHeight(r.origin) || 0;
                //@TODO hardcoded limit of 5 txs
                height = height > r.height + 5 ? r.height + 5 : height;
                for (let h = r.height + 1; h <= height; h++) {
                    const structTx = await this.chain.getTx(h, r.origin);
                    structTx && this.broadcastTx(structTx, status.getOrigin());
                }
                // resend ownTx
                r.origin === me && r.height + 1 === this.ownTx.height && this.broadcastTx(this.ownTx, status.getOrigin());
            }
        })();
        this.mapStatus.set(status.getOrigin(), status);
    }
    getStatus() {
        return [...this.mapStatus.values()];
    }
    async addTx(structTx) {
        //@FIXME logging
        Logger.trace(`${this.config.port}: NEW TX stored locally #${structTx.height} from ${structTx.origin}`);
        try {
            await this.chain.add(structTx);
        }
        catch (error) {
            Logger.warn(`${this.config.port}: addTx failed, ${error}`);
            return;
        }
        if (this.ownTx.hash === structTx.hash) {
            this.ownTx = {};
        }
        this.mapTx.delete(structTx.hash);
        // push the tx to the queue of the feed (websocket)
        this.server.queueWebSocketFeed(structTx);
        // broadcast complete Tx
        this.broadcastTx(structTx);
        // create a new TxMessage
        this.createOwnTx();
    }
    broadcastTx(structTx, to) {
        const me = this.wallet.getPublicKey();
        const txMsg = new TxMessage(structTx, me).asString(this.wallet);
        this.network.broadcast(txMsg, to);
    }
}
//# sourceMappingURL=tx-factory.js.map