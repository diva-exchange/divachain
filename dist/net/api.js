"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Api = exports.NAME_HEADER_API_TOKEN = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const nanoid_1 = require("nanoid");
const crypto_1 = __importDefault(require("crypto"));
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
exports.NAME_HEADER_API_TOKEN = 'diva-api-token';
const DEFAULT_LENGTH_TOKEN = 32;
class Api {
    constructor(server) {
        this.package = require('../../package.json');
        this.token = '';
        this.server = server;
        this.pathToken = path_1.default.join(this.server.config.path_keys, (0, i2p_sam_1.toB32)(this.server.config.http) + '.token');
        this.createToken();
        this.route();
    }
    static make(server) {
        return new Api(server);
    }
    createToken() {
        fs_1.default.writeFileSync(this.pathToken, (0, nanoid_1.nanoid)(DEFAULT_LENGTH_TOKEN), { mode: '0600' });
        this.token = fs_1.default.readFileSync(this.pathToken).toString();
        setTimeout(() => {
            this.createToken();
        }, crypto_1.default.randomInt(180000, 600000));
    }
    route() {
        this.server.app.get('/join/:http/:udp/:publicKey', (req, res) => {
            return this.server.getBootstrap().join(req.params.http, req.params.udp, req.params.publicKey)
                ? res
                    .status(200)
                    .json({ http: (0, i2p_sam_1.toB32)(req.params.http), udp: (0, i2p_sam_1.toB32)(req.params.udp), publicKey: req.params.publicKey })
                : res.status(403).end();
        });
        this.server.app.get('/challenge/:token', (req, res) => {
            const signedToken = this.server.getBootstrap().challenge(req.params.token);
            return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
        });
        this.server.app.get('/sync/:height', async (req, res) => {
            const h = Math.floor(Number(req.params.height) || 0);
            return this.server.getBlockchain().getHeight() >= h
                ? res.json(await this.server.getBlockchain().getRange(h, h + this.server.config.network_sync_size))
                : res.status(404).end();
        });
        this.server.app.get('/about', (req, res) => {
            return res.json({
                version: this.package.version,
                license: this.package.license,
                publicKey: this.server.getWallet().getPublicKey(),
                height: this.server.getBlockchain().getHeight(),
            });
        });
        this.server.app.get('/network/:stake?', (req, res) => {
            const s = Math.floor(Number(req.params.stake) || 0);
            const a = this.server.getNetwork().getArrayNetwork();
            return res.json(s > 0 ? a.filter((r) => r['stake'] >= s) : a);
        });
        this.server.app.get('/state/search/:q?', async (req, res) => {
            try {
                return res.json(await this.server.getBlockchain().searchState(req.params.q || ''));
            }
            catch (error) {
                return res.status(404).end();
            }
        });
        this.server.app.get('/state/:key', async (req, res) => {
            const key = req.params.key || '';
            const state = await this.server.getBlockchain().getState(key);
            return state ? res.json(state) : res.status(404).end();
        });
        this.server.app.get('/stack', (req, res) => {
            return res.json(this.server.getPool().getStack());
        });
        this.server.app.get('/pool/tx', (req, res) => {
            return res.json(this.server.getPool().getArrayPoolTx());
        });
        this.server.app.get('/pool/votes', (req, res) => {
            return res.json(this.server.getPool().getArrayPoolVotes());
        });
        this.server.app.get('/block/genesis', async (req, res) => {
            return res.json((await this.server.getBlockchain().getRange(1))[0]);
        });
        this.server.app.get('/block/latest', async (req, res) => {
            return res.json(this.server.getBlockchain().getLatestBlock());
        });
        this.server.app.get('/block/:height', async (req, res) => {
            const h = Math.floor(Number(req.params.height || 0));
            if (h < 1 || h > this.server.getBlockchain().getHeight()) {
                return res.status(404).end();
            }
            return res.json((await this.server.getBlockchain().getRange(h))[0]);
        });
        this.server.app.get('/blocks/search/:q?', async (req, res) => {
            try {
                return res.json(await this.server.getBlockchain().searchBlocks(req.params.q || ''));
            }
            catch (error) {
                return res.status(404).end();
            }
        });
        this.server.app.get('/blocks/page/:page/:size?', async (req, res) => {
            const page = Number(req.params.page || 1);
            const size = Number(req.params.size || 0);
            try {
                return res.json(await this.server.getBlockchain().getPage(page, size));
            }
            catch (error) {
                return res.status(404).end();
            }
        });
        this.server.app.get('/blocks/:gte?/:lte?', async (req, res) => {
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
        });
        this.server.app.get('/transaction/:origin/:ident', async (req, res) => {
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
        });
        this.server.app.put('/transaction/:ident?', async (req, res) => {
            const ident = this.server.stackTx(req.body, req.params.ident);
            if (ident) {
                return res.json({ ident: ident });
            }
            res.status(403).end();
        });
        this.server.app.get('/debug/performance/:height', async (req, res) => {
            const height = Number(req.params.height || 0);
            return res.json(await this.server.getBlockchain().getPerformance(height));
        });
    }
}
exports.Api = Api;
