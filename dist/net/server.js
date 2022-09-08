"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const logger_1 = require("../logger");
const http_errors_1 = __importDefault(require("http-errors"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const ws_1 = __importDefault(require("ws"));
const compression_1 = __importDefault(require("compression"));
const bootstrap_1 = require("./bootstrap");
const blockchain_1 = require("../chain/blockchain");
const validation_1 = require("./validation");
const pool_1 = require("./pool");
const wallet_1 = require("../chain/wallet");
const network_1 = require("./network");
const message_1 = require("./message/message");
const api_1 = require("./api");
const vote_1 = require("./message/vote");
const proposal_1 = require("./message/proposal");
const sync_1 = require("./message/sync");
class Server {
    constructor(config) {
        this.pool = {};
        this.bootstrap = {};
        this.wallet = {};
        this.network = {};
        this.blockchain = {};
        this.validation = {};
        this.timeoutUpdateOwnProposal = {};
        this.timeoutVote = {};
        this.config = config;
        logger_1.Logger.info(`divachain ${this.config.VERSION} instantiating...`);
        this.app = (0, express_1.default)();
        this.app.set('x-powered-by', false);
        this.app.use((0, compression_1.default)());
        this.app.use(express_1.default.json());
        this.app.get('/favicon.ico', (req, res) => {
            res.sendStatus(204);
        });
        api_1.Api.make(this);
        logger_1.Logger.info('Api initialized');
        this.app.use((req, res, next) => {
            next((0, http_errors_1.default)(404));
        });
        this.app.use(Server.error);
        this.httpServer = http_1.default.createServer(this.app);
        this.httpServer.on('listening', () => {
            logger_1.Logger.info(`HttpServer listening on ${this.config.ip}:${this.config.port}`);
        });
        this.httpServer.on('close', () => {
            logger_1.Logger.info(`HttpServer closing on ${this.config.ip}:${this.config.port}`);
        });
        this.webSocketServerBlockFeed = new ws_1.default.Server({
            host: this.config.ip,
            port: this.config.port_block_feed,
            perMessageDeflate: false,
        });
        this.webSocketServerBlockFeed.on('connection', (ws) => {
            ws.on('error', (error) => {
                logger_1.Logger.warn('WebSocketServerBlockFeed.error: ' + error.toString());
                ws.terminate();
            });
        });
        this.webSocketServerBlockFeed.on('close', () => {
            logger_1.Logger.info(`WebSocket Server closing on ${this.config.ip}:${this.config.port_block_feed}`);
        });
        this.webSocketServerBlockFeed.on('listening', () => {
            logger_1.Logger.info(`WebSocket Server listening on ${this.config.ip}:${this.config.port_block_feed}`);
        });
    }
    async start() {
        logger_1.Logger.info(`HTTP endpoint ${this.config.http}`);
        logger_1.Logger.info(`UDP endpoint ${this.config.udp}`);
        this.wallet = wallet_1.Wallet.make(this.config);
        logger_1.Logger.info('Wallet initialized');
        this.blockchain = await blockchain_1.Blockchain.make(this);
        if (this.blockchain.getHeight() === 0) {
            await this.blockchain.reset(blockchain_1.Blockchain.genesis(this.config.path_genesis));
        }
        logger_1.Logger.info('Blockchain initialized');
        this.validation = validation_1.Validation.make(this);
        logger_1.Logger.info('Validation initialized');
        this.pool = pool_1.Pool.make(this);
        logger_1.Logger.info('Pool initialized');
        await this.httpServer.listen(this.config.port, this.config.ip);
        this.network = network_1.Network.make(this, (m) => {
            this.onMessage(m);
        });
        return new Promise((resolve) => {
            this.network.once('ready', async () => {
                this.bootstrap = bootstrap_1.Bootstrap.make(this);
                if (this.config.bootstrap) {
                    await this.bootstrap.syncWithNetwork();
                    if (!this.blockchain.hasNetworkHttp(this.config.http)) {
                        await this.bootstrap.joinNetwork(this.wallet.getPublicKey());
                    }
                }
                resolve(this);
            });
        });
    }
    async shutdown() {
        clearTimeout(this.timeoutUpdateOwnProposal);
        clearTimeout(this.timeoutVote);
        this.network.shutdown();
        this.wallet.close();
        await this.blockchain.shutdown();
        if (this.httpServer) {
            return await new Promise((resolve) => {
                this.httpServer.close(() => {
                    resolve();
                });
            });
        }
        else {
            return Promise.resolve();
        }
    }
    getBootstrap() {
        return this.bootstrap;
    }
    getPool() {
        return this.pool;
    }
    getWallet() {
        return this.wallet;
    }
    getBlockchain() {
        return this.blockchain;
    }
    getValidation() {
        return this.validation;
    }
    getNetwork() {
        return this.network;
    }
    stackTx(commands, ident = '') {
        const i = this.pool.stack(commands, ident);
        if (!i) {
            return false;
        }
        this.doPropose();
        return i;
    }
    doPropose() {
        const p = this.pool.getOwnProposal();
        if (p) {
            this.processProposal(p);
            this.network.broadcast(p);
        }
        clearTimeout(this.timeoutUpdateOwnProposal);
        this.timeoutUpdateOwnProposal = setTimeout(() => {
            this.pool.updateOwnProposal();
            this.doPropose();
        }, this.network.getArrayNetwork().length * 500);
    }
    processProposal(proposal) {
        const p = proposal.get();
        if (!proposal_1.Proposal.isValid(p)) {
            return;
        }
        if (this.pool.propose(p)) {
            clearTimeout(this.timeoutVote);
            this.timeoutVote = setTimeout(() => {
                this.doVote();
            }, this.network.getArrayNetwork().length * 50);
        }
    }
    doVote() {
        const v = this.pool.getCurrentVote();
        if (v) {
            this.processVote(v);
            this.network.broadcast(v);
        }
    }
    processVote(vote) {
        const v = vote.get();
        if (!vote_1.Vote.isValid(v)) {
            return;
        }
        if (this.pool.vote(v)) {
            this.network.broadcast(new sync_1.Sync().create(this.wallet, this.pool.getBlock()));
            this.addBlock(this.pool.getBlock());
            return;
        }
        clearTimeout(this.timeoutVote);
        this.timeoutVote = setTimeout(() => {
            this.doVote();
        }, this.network.getArrayNetwork().length * 200);
    }
    processSync(sync) {
        const s = sync.get();
        if (this.getBlockchain().getHeight() + 1 === s.block.height) {
            this.addBlock(s.block);
        }
    }
    addBlock(block) {
        if (!this.blockchain.add(block)) {
            return;
        }
        this.pool.clear(block);
        setImmediate((s) => {
            this.webSocketServerBlockFeed.clients.forEach((ws) => ws.readyState === ws_1.default.OPEN && ws.send(s));
        }, JSON.stringify(block));
        this.doPropose();
    }
    onMessage(m) {
        switch (m.type()) {
            case message_1.Message.TYPE_PROPOSAL:
                this.processProposal(new proposal_1.Proposal(m.pack()));
                break;
            case message_1.Message.TYPE_VOTE:
                this.processVote(new vote_1.Vote(m.pack()));
                break;
            case message_1.Message.TYPE_SYNC:
                this.processSync(new sync_1.Sync(m.pack()));
                break;
            default:
                throw new Error('Invalid message type');
        }
    }
    static error(err, req, res, next) {
        res.status(err.status || 500);
        res.json({
            path: req.path,
            status: err.status || 500,
            message: err.message,
            error: process.env.NODE_ENV === 'development' ? err : {},
        });
        next();
    }
}
exports.Server = Server;
