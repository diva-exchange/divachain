"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const config_1 = require("../config");
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
const network_sam_1 = require("./network-sam");
const message_1 = require("./message/message");
const api_1 = require("./api");
const sync_1 = require("./message/sync");
const lock_1 = require("./message/lock");
class Server {
    constructor(config) {
        this.pool = {};
        this.bootstrap = {};
        this.wallet = {};
        this.network = {};
        this.blockchain = {};
        this.validation = {};
        this.stackSync = [];
        this.timeoutLock = {};
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
        this.webSocketServer = new ws_1.default.Server({
            server: this.httpServer,
            clientTracking: false,
            perMessageDeflate: false,
            skipUTF8Validation: true,
        });
        this.webSocketServer.on('connection', (ws) => {
            ws.on('error', (error) => {
                logger_1.Logger.warn('Server webSocketServer.error: ' + JSON.stringify(error));
                ws.terminate();
            });
        });
        this.webSocketServer.on('close', () => {
            logger_1.Logger.info('WebSocketServer closing');
        });
        this.webSocketServerBlockFeed = new ws_1.default.Server({
            host: this.config.ip,
            port: this.config.port_block_feed,
        });
        this.webSocketServerBlockFeed.on('connection', (ws) => {
            ws.on('error', (error) => {
                logger_1.Logger.warn('Server webSocketServerBlockFeed.error: ' + JSON.stringify(error));
                ws.terminate();
            });
        });
        this.webSocketServerBlockFeed.on('close', () => {
            logger_1.Logger.info('WebSocketServerBlockFeed closing');
        });
    }
    async start() {
        this.bootstrap = await bootstrap_1.Bootstrap.make(this);
        logger_1.Logger.info(`Address ${this.config.address}`);
        logger_1.Logger.trace(this.config);
        this.wallet = wallet_1.Wallet.make(this.config);
        logger_1.Logger.info('Wallet initialized');
        this.blockchain = await blockchain_1.Blockchain.make(this);
        logger_1.Logger.info('Blockchain initialized');
        this.validation = validation_1.Validation.make();
        logger_1.Logger.info('Validation initialized');
        this.network = network_sam_1.NetworkSam.make(this, (type, message) => {
            return this.onMessage(type, message);
        });
        logger_1.Logger.info('Network initialized');
        this.pool = pool_1.Pool.make(this);
        logger_1.Logger.info('Pool initialized');
        await this.httpServer.listen(this.config.port, this.config.ip);
        if (this.config.bootstrap) {
            await this.bootstrap.syncWithNetwork();
            if (!this.network.hasNetworkAddress(this.config.address)) {
                await this.bootstrap.enterNetwork(this.wallet.getPublicKey());
            }
        }
        if (this.blockchain.getHeight() === 0) {
            await this.blockchain.reset(blockchain_1.Blockchain.genesis(this.config.path_genesis));
        }
        this.pool.initHeight();
        return new Promise((resolve) => {
            this.network.once('ready', resolve);
        });
    }
    async shutdown() {
        this.wallet.close();
        this.network.shutdown();
        await this.blockchain.shutdown();
        if (this.webSocketServer) {
            await new Promise((resolve) => {
                this.webSocketServer.close(resolve);
            });
        }
        if (this.httpServer) {
            await new Promise((resolve) => {
                this.httpServer.close(resolve);
            });
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
    getNetwork() {
        return this.network;
    }
    getBlockchain() {
        return this.blockchain;
    }
    getValidation() {
        return this.validation;
    }
    stackTx(arrayCommand, ident = '') {
        const s = this.pool.stack(ident, arrayCommand);
        s && this.pool.release() && this.doLock();
        return s || false;
    }
    doLock() {
        if (this.pool.hasTransactions()) {
            this.processLock(this.pool.getLock());
            this.timeoutLock = setTimeout(() => {
                this.doLock();
            }, config_1.PBFT_RETRY_INTERVAL_MS);
        }
    }
    processLock(lock) {
        const l = lock.get();
        if (!lock_1.Lock.isValid(l)) {
            return;
        }
        if (!this.pool.add(l)) {
            return;
        }
        if (this.pool.hasBlock()) {
            this.network.broadcast(lock);
            logger_1.Logger.trace(`LOCKED: ${this.pool.getBlock().height} ${this.pool.getBlock().hash}`);
            const sync = new sync_1.Sync().create(this.pool.getBlock());
            this.network.broadcast(sync);
            this.processSync(sync);
        }
        else {
            const _lock = this.pool.getLock();
            _lock && this.network.broadcast(_lock);
        }
    }
    processSync(sync) {
        this.stackSync = this.stackSync.concat(sync.get().block).sort((a, b) => (a.height > b.height ? 1 : -1));
        let h = this.blockchain.getHeight();
        let b = (this.stackSync.shift() || {});
        while (b.height) {
            if (b.height === h + 1) {
                this.addBlock(b);
            }
            else if (b.height > h + 1) {
                break;
            }
            h = this.blockchain.getHeight();
            b = (this.stackSync.shift() || {});
        }
    }
    addBlock(block) {
        clearTimeout(this.timeoutLock);
        this.pool.clear(block);
        if (this.blockchain.add(block)) {
            logger_1.Logger.trace(`Block added: ${block.height}`);
            setImmediate((s) => {
                this.webSocketServerBlockFeed.clients.forEach((ws) => ws.send(s));
            }, JSON.stringify(block));
        }
        this.pool.release() && this.doLock();
    }
    onMessage(type, message) {
        switch (type) {
            case message_1.Message.TYPE_LOCK:
                this.processLock(new lock_1.Lock(message));
                break;
            case message_1.Message.TYPE_SYNC:
                this.processSync(new sync_1.Sync(message));
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
