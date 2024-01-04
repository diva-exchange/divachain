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
import { toB32 } from '@diva.exchange/i2p-sam';
import { Chain } from '../chain/chain.js';
import { NAME_HEADER_TOKEN_API } from '../chain/wallet.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
export class Api {
    package;
    server;
    static make(server) {
        return new Api(server);
    }
    constructor(server) {
        const _d = path.dirname(fileURLToPath(import.meta.url));
        this.package = JSON.parse(fs.readFileSync(path.join(_d, '../../package.json')).toString());
        this.server = server;
        this.route();
    }
    route() {
        // GET - general
        this.server.app.get('/about', async (req, res) => {
            return await this.about(res);
        });
        // GET - joining
        this.server.app.get('/join/:http/:udp/:publicKey', (req, res) => {
            return this.join(req, res);
        });
        this.server.app.get('/challenge/:token', (req, res) => {
            return this.challenge(req, res);
        });
        // GET - synchronization
        this.server.app.get('/sync/:height/:origin?', async (req, res) => {
            return await this.sync(req, res);
        });
        // GET testnet
        this.server.app.get('/testnet/token', async (req, res) => {
            return this.server.config.is_testnet
                ? res.json({ header: NAME_HEADER_TOKEN_API, token: this.server.getWallet().getTokenAPI() })
                : res.status(403).end();
        });
        // GET - network
        this.server.app.get('/network/:stake?', (req, res) => {
            return this.network(req, res);
        });
        // GET - state
        this.server.app.get('/state/search/:q?', async (req, res) => {
            return await this.stateSearch(req, res);
        });
        this.server.app.get('/state/:key', async (req, res) => {
            return await this.state(req, res);
        });
        // GET - tx
        this.server.app.get('/genesis', async (req, res) => {
            return await this.getGenesis(res);
        });
        this.server.app.get('/tx/latest/:origin?', (req, res) => {
            return this.getLatest(req, res);
        });
        this.server.app.get('/tx/search/:q/:origin?', async (req, res) => {
            return await this.search(req, res);
        });
        this.server.app.get('/tx/page/:page/:size?/:origin?', async (req, res) => {
            return await this.getPage(req, res);
        });
        this.server.app.get('/tx/:height/:origin?', async (req, res) => {
            return await this.getTx(req, res);
        });
        // GET - txs
        this.server.app.get('/txs/:gte?/:lte?/:origin?', async (req, res) => {
            return await this.txs(req, res);
        });
        //@TODO access rights? (next to the token)
        // PUT
        this.server.app.put('/tx', (req, res) => {
            return req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
                ? this.putTransaction(req, res)
                : res.status(401).end();
        });
        this.server.app.put('/leave', (req, res) => {
            return req.headers[NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
                ? this.leave(res)
                : res.status(401).end();
        });
        // GET - debug
        this.server.app.get('/debug/performance/:height', async (req, res) => {
            return res.json(await this.server.getChain().getPerformance(Number(req.params.height || 0)));
        });
    }
    join(req, res) {
        return this.server.getBootstrap().join(req.params.http, req.params.udp, req.params.publicKey)
            ? res.status(200).json({
                http: toB32(req.params.http),
                udp: toB32(req.params.udp),
                publicKey: req.params.publicKey,
            })
            : res.status(403).end();
    }
    leave(res) {
        if (this.server.stackTx([
            {
                command: Chain.COMMAND_REMOVE_PEER,
                publicKey: this.server.getWallet().getPublicKey(),
            },
        ])) {
            return res.status(200).end();
        }
        return res.status(403).end();
    }
    challenge(req, res) {
        const signedToken = this.server.getBootstrap().challenge(req.params.token);
        return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
    }
    async sync(req, res) {
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        const h = Math.floor(Number(req.params.height) || 1);
        const height = this.server.getChain().getHeight(origin) || 0;
        return height >= h
            ? res.json(await this.server.getChain().getRange(h, h + this.server.config.network_sync_size, origin))
            : res.status(404).end();
    }
    async about(res) {
        return res.json({
            version: this.package.version,
            license: this.package.license,
            publicKey: this.server.getWallet().getPublicKey(),
        });
    }
    network(req, res) {
        const s = Math.floor(Number(req.params.stake) || 0);
        const a = this.server.getNetwork().getArrayNetwork();
        return res.json(s > 0 ? a.filter((r) => r['stake'] >= s) : a);
    }
    async stateSearch(req, res) {
        return res.json(await this.server.getChain().searchState(req.params.q || ''));
    }
    async state(req, res) {
        const key = req.params.key || '';
        const state = await this.server.getChain().getState(key);
        return state ? res.json(state) : res.status(404).end();
    }
    async getGenesis(res) {
        const tx = await this.server.getChain().getTx(1, this.server.getWallet().getPublicKey());
        return tx ? res.json(tx) : res.status(404).end();
    }
    getLatest(req, res) {
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        const tx = this.server.getChain().getLatestTx(origin);
        return tx ? res.json(tx) : res.status(404).end();
    }
    async getTx(req, res) {
        const height = Number(req.params.height || 0);
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        const tx = await this.server.getChain().getTx(height, origin);
        return tx ? res.json(tx) : res.status(404).end();
    }
    async search(req, res) {
        const q = req.params.q || '';
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        const a = await this.server.getChain().search(q, origin);
        return a ? res.json(a) : res.status(404).end();
    }
    async getPage(req, res) {
        const page = Number(req.params.page || 1);
        const size = Number(req.params.size || 0);
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        const a = await this.server.getChain().getPage(page, size, origin);
        return a ? res.json(a) : res.status(404).end();
    }
    async txs(req, res) {
        const gte = Math.floor(Number(req.params.gte || 1));
        const lte = Math.floor(Number(req.params.lte || 0));
        const origin = req.params.origin || this.server.getWallet().getPublicKey();
        if (gte < 1) {
            return res.status(404).end();
        }
        const a = await this.server.getChain().getRange(gte, lte, origin);
        return a ? res.json(a) : res.status(404).end();
    }
    putTransaction(req, res) {
        return this.server.stackTx(req.body) ? res.status(200).end() : res.status(403).end();
    }
}
//# sourceMappingURL=api.js.map