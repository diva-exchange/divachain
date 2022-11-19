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
const wallet_1 = require("../chain/wallet");
const network_1 = require("./network");
const api_1 = require("./api");
const block_factory_1 = require("./block-factory");
class Server {
    constructor(config) {
        this.blockFactory = {};
        this.bootstrap = {};
        this.wallet = {};
        this.network = {};
        this.blockchain = {};
        this.validation = {};
        this.mapStakeCredit = new Map();
        this.stackModifyStake = [];
        this.config = config;
        logger_1.Logger.info(`divachain ${this.config.VERSION} instantiating...`);
        this.config.is_testnet && logger_1.Logger.warn('IMPORTANT: this is a test node (API is NOT protected)');
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
        this.network = network_1.Network.make(this, (m) => {
            this.blockFactory.processMessage(m);
        });
        this.blockFactory = block_factory_1.BlockFactory.make(this);
        logger_1.Logger.info('BlockFactory initialized');
        this.httpServer.listen(this.config.port, this.config.ip);
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
        typeof this.blockFactory.shutdown === 'function' && this.blockFactory.shutdown();
        typeof this.network.shutdown === 'function' && this.network.shutdown();
        typeof this.wallet.close === 'function' && this.wallet.close();
        typeof this.blockchain.shutdown === 'function' && (await this.blockchain.shutdown());
        if (typeof this.httpServer.close === 'function') {
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
    getBlockFactory() {
        return this.blockFactory;
    }
    getStackModifyStake() {
        return this.stackModifyStake;
    }
    proposeModifyStake(forPublicKey, ident, stake) {
        if (this.stackModifyStake.some((cmd) => cmd.publicKey === forPublicKey && cmd.ident === ident)) {
            return false;
        }
        const credit = (this.mapStakeCredit.get(forPublicKey) || 0) - 1;
        if (credit > -1 * (this.network.getArrayOnline().length / 3)) {
            this.mapStakeCredit.set(forPublicKey, credit);
            this.stackModifyStake.push({
                command: blockchain_1.Blockchain.COMMAND_MODIFY_STAKE,
                publicKey: forPublicKey,
                ident: ident,
                stake: stake,
            });
            if (this.stackModifyStake.length >= this.network.getArrayOnline().length / 3) {
                this.stackTx(this.stackModifyStake);
                this.stackModifyStake = [];
            }
        }
        return true;
    }
    incStakeCredit(publicKey) {
        this.mapStakeCredit.set(publicKey, (this.mapStakeCredit.get(publicKey) || 0) + 1);
    }
    stackTx(commands, ident = '') {
        let s = 1;
        const i = this.blockFactory.stack(commands.map((c) => {
            c.seq = s;
            s++;
            return c;
        }), ident);
        if (!i) {
            return false;
        }
        return i;
    }
    feedBlock(block) {
        setImmediate((block) => {
            this.webSocketServerBlockFeed.clients.forEach((ws) => ws.readyState === ws_1.default.OPEN && ws.send(JSON.stringify(block)));
        }, block);
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
