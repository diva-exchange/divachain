"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Api = void 0;
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const blockchain_1 = require("../chain/blockchain");
const wallet_1 = require("../chain/wallet");
class Api {
    constructor(server) {
        this.package = require('../../package.json');
        this.server = server;
        this.route();
    }
    static make(server) {
        return new Api(server);
    }
    route() {
        this.server.app.get('/join/:http/:udp/:publicKey', (req, res) => {
            this.join(req, res);
        });
        this.server.app.get('/challenge/:token', (req, res) => {
            this.challenge(req, res);
        });
        this.server.app.get('/sync/:height', async (req, res) => {
            await this.sync(req, res);
        });
        this.server.app.get('/about', (req, res) => {
            this.about(res);
        });
        this.server.app.get('/testnet/token', async (req, res) => {
            return this.server.config.is_testnet
                ? res.json({ header: wallet_1.NAME_HEADER_TOKEN_API, token: this.server.getWallet().getTokenAPI() })
                : res.status(403).end();
        });
        this.server.app.get('/network/online', (req, res) => {
            this.networkOnline(res);
        });
        this.server.app.get('/network/:stake?', (req, res) => {
            this.network(req, res);
        });
        this.server.app.get('/state/search/:q?', async (req, res) => {
            await this.stateSearch(req, res);
        });
        this.server.app.get('/state/:key', async (req, res) => {
            await this.state(req, res);
        });
        this.server.app.get('/stack/stake', (req, res) => {
            this.stackModifyStake(res);
        });
        this.server.app.get('/stack', (req, res) => {
            this.stack(res);
        });
        this.server.app.get('/block/genesis', async (req, res) => {
            await this.blockGenesis(res);
        });
        this.server.app.get('/block/latest', (req, res) => {
            this.blockLatest(res);
        });
        this.server.app.get('/block/:height', async (req, res) => {
            await this.block(req, res);
        });
        this.server.app.get('/blocks/search/:q?', async (req, res) => {
            await this.blocksSearch(req, res);
        });
        this.server.app.get('/blocks/page/:page/:size?', async (req, res) => {
            await this.blocksPage(req, res);
        });
        this.server.app.get('/blocks/:gte?/:lte?', async (req, res) => {
            await this.blocks(req, res);
        });
        this.server.app.get('/transaction/:origin/:ident', async (req, res) => {
            await this.transaction(req, res);
        });
        this.server.app.put('/transaction/:ident?', async (req, res) => {
            req.headers[wallet_1.NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
                ? await this.putTransaction(req, res)
                : res.status(401).end();
        });
        this.server.app.put('/leave', (req, res) => {
            req.headers[wallet_1.NAME_HEADER_TOKEN_API] === this.server.getWallet().getTokenAPI()
                ? this.leave(res)
                : res.status(401).end();
        });
        this.server.app.get('/debug/performance/:height', async (req, res) => {
            const height = Number(req.params.height || 0);
            return res.json(await this.server.getBlockchain().getPerformance(height));
        });
    }
    join(req, res) {
        return this.server.getBootstrap().join(req.params.http, req.params.udp, req.params.publicKey)
            ? res
                .status(200)
                .json({ http: (0, i2p_sam_1.toB32)(req.params.http), udp: (0, i2p_sam_1.toB32)(req.params.udp), publicKey: req.params.publicKey })
            : res.status(403).end();
    }
    leave(res) {
        const ident = this.server.stackTx([
            {
                seq: 1,
                command: blockchain_1.Blockchain.COMMAND_REMOVE_PEER,
                publicKey: this.server.getWallet().getPublicKey(),
            },
        ]);
        if (ident) {
            return res.json({ ident: ident });
        }
        res.status(403).end();
    }
    challenge(req, res) {
        const signedToken = this.server.getBootstrap().challenge(req.params.token);
        return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
    }
    async sync(req, res) {
        const h = Math.floor(Number(req.params.height) || 0);
        return this.server.getBlockchain().getHeight() >= h
            ? res.json(await this.server.getBlockchain().getRange(h, h + this.server.config.network_sync_size))
            : res.status(404).end();
    }
    about(res) {
        return res.json({
            version: this.package.version,
            license: this.package.license,
            publicKey: this.server.getWallet().getPublicKey(),
            height: this.server.getBlockchain().getHeight(),
        });
    }
    networkOnline(res) {
        return res.json(this.server.getNetwork().getArrayOnline().sort());
    }
    network(req, res) {
        const s = Math.floor(Number(req.params.stake) || 0);
        const a = this.server.getNetwork().getArrayNetwork();
        return res.json(s > 0 ? a.filter((r) => r['stake'] >= s) : a);
    }
    async stateSearch(req, res) {
        try {
            return res.json(await this.server.getBlockchain().searchState(req.params.q || ''));
        }
        catch (error) {
            return res.status(404).end();
        }
    }
    async state(req, res) {
        const key = req.params.key || '';
        const state = await this.server.getBlockchain().getState(key);
        return state ? res.json(state) : res.status(404).end();
    }
    stack(res) {
        return res.json(this.server.getBlockFactory().getStack());
    }
    async blockGenesis(res) {
        return res.json((await this.server.getBlockchain().getRange(1))[0]);
    }
    blockLatest(res) {
        return res.json(this.server.getBlockchain().getLatestBlock());
    }
    async block(req, res) {
        const h = Math.floor(Number(req.params.height || 0));
        if (h < 1 || h > this.server.getBlockchain().getHeight()) {
            return res.status(404).end();
        }
        return res.json((await this.server.getBlockchain().getRange(h))[0]);
    }
    async blocksSearch(req, res) {
        try {
            return res.json(await this.server.getBlockchain().searchBlocks(req.params.q || ''));
        }
        catch (error) {
            return res.status(404).end();
        }
    }
    async blocksPage(req, res) {
        const page = Number(req.params.page || 1);
        const size = Number(req.params.size || 0);
        try {
            return res.json(await this.server.getBlockchain().getPage(page, size));
        }
        catch (error) {
            return res.status(404).end();
        }
    }
    async blocks(req, res) {
        const gte = Math.floor(Number(req.params.gte || 1));
        const lte = Math.floor(Number(req.params.lte || 0));
        if (gte < 1) {
            return res.status(404).end();
        }
        try {
            return res.json(await this.server.getBlockchain().getRange(gte, lte));
        }
        catch (error) {
            return res.status(404).end();
        }
    }
    async transaction(req, res) {
        const origin = req.params.origin || '';
        const ident = req.params.ident || '';
        if (!origin || !ident) {
            return res.status(404).end();
        }
        try {
            return res.json(await this.server.getBlockchain().getTransaction(origin, ident));
        }
        catch (error) {
            return res.status(404).end();
        }
    }
    stackModifyStake(res) {
        return res.json(this.server.getStackModifyStake());
    }
    async putTransaction(req, res) {
        const ident = this.server.stackTx(req.body, req.params.ident);
        if (ident) {
            return res.json({ ident: ident });
        }
        res.status(403).end();
    }
}
exports.Api = Api;
