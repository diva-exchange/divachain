"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockFactory = void 0;
const transaction_1 = require("../chain/transaction");
const nanoid_1 = require("nanoid");
const add_tx_1 = require("./message/add-tx");
const logger_1 = require("../logger");
const config_1 = require("../config");
const block_1 = require("../chain/block");
const message_1 = require("./message/message");
const propose_block_1 = require("./message/propose-block");
const sign_block_1 = require("./message/sign-block");
const confirm_block_1 = require("./message/confirm-block");
const status_1 = require("./message/status");
const util_1 = require("../chain/util");
const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;
class BlockFactory {
    constructor(server) {
        this.stackTransaction = [];
        this.ownTx = {};
        this.current = new Map();
        this.arrayPoolTx = [];
        this.block = {};
        this.validator = '';
        this.mapValidatorDist = new Map();
        this.mapAvailability = new Map();
        this.isSyncing = false;
        this.timeoutAddTx = {};
        this.timeoutProposeBlock = {};
        this.timeoutRetry = {};
        this.server = server;
        this.config = server.config;
        this.blockchain = server.getBlockchain();
        this.network = server.getNetwork();
        this.validation = server.getValidation();
        this.wallet = server.getWallet();
    }
    static make(server) {
        return new BlockFactory(server);
    }
    shutdown() {
        this.removeTimeout();
    }
    calcValidator() {
        const h = this.blockchain.getHeight();
        const a = this.network
            .getArrayNetwork()
            .map((p) => p.publicKey)
            .sort();
        const l = a.length;
        const mod = h % l;
        const shift = (h + Math.floor(h / l)) % l;
        let i = mod;
        let r = 0;
        do {
            if (this.network.getArrayOnline().includes(a[i])) {
                this.validator = a[i];
                return;
            }
            i = (!r ? i + shift : i) + 1;
            i = i < l ? i : i - l;
        } while (r++ < l);
        logger_1.Logger.warn('No validator found. Network unstable.');
    }
    isValidator(origin = this.wallet.getPublicKey()) {
        return origin === this.validator;
    }
    getMapValidatorDist() {
        return [...this.mapValidatorDist.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1));
    }
    stack(commands, ident = '') {
        const height = this.blockchain.getHeight() + 1;
        ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : (0, nanoid_1.nanoid)(DEFAULT_LENGTH_IDENT);
        if (!this.validation.validateTx(height, new transaction_1.Transaction(this.wallet, height, ident, commands).get())) {
            return false;
        }
        this.stackTransaction.push({ ident: ident, commands: commands });
        this.doAddTx();
        return ident;
    }
    getStack() {
        return this.stackTransaction;
    }
    hasBlock() {
        return this.block.height > 0;
    }
    processMessage(m) {
        switch (m.type()) {
            case message_1.Message.TYPE_ADD_TX:
            case message_1.Message.TYPE_PROPOSE_BLOCK:
            case message_1.Message.TYPE_SIGN_BLOCK:
            case message_1.Message.TYPE_CONFIRM_BLOCK:
                this.calcValidator();
                break;
        }
        switch (m.type()) {
            case message_1.Message.TYPE_ADD_TX:
                this.isValidator() && this.processAddTx(new add_tx_1.AddTx(m.asBuffer()));
                break;
            case message_1.Message.TYPE_PROPOSE_BLOCK:
                this.isValidator(m.origin()) && this.processProposeBlock(new propose_block_1.ProposeBlock(m.asBuffer()));
                break;
            case message_1.Message.TYPE_SIGN_BLOCK:
                this.isValidator() && this.processSignBlock(new sign_block_1.SignBlock(m.asBuffer()));
                break;
            case message_1.Message.TYPE_CONFIRM_BLOCK:
                this.isValidator(m.origin()) && this.processConfirmBlock(new confirm_block_1.ConfirmBlock(m.asBuffer()));
                break;
            case message_1.Message.TYPE_STATUS:
                this.processStatus(new status_1.Status(m.asBuffer()));
                break;
            default:
                throw new Error('Invalid message type');
        }
    }
    doAddTx() {
        if (this.ownTx.height || !this.stackTransaction.length) {
            return;
        }
        const height = this.blockchain.getHeight() + 1;
        const r = this.stackTransaction.shift();
        const tx = new transaction_1.Transaction(this.wallet, height, r.ident, r.commands).get();
        this.ownTx = {
            height: height,
            tx: tx,
        };
        this.calcValidator();
        const atx = new add_tx_1.AddTx().create(this.wallet, this.validator, height, tx);
        this.isValidator() ? this.processAddTx(atx) : this.network.broadcast(atx);
        this.setupRetry();
    }
    processAddTx(addTx) {
        const height = this.blockchain.getHeight() + 1;
        if (this.hasBlock() ||
            addTx.height() !== height ||
            this.current.has(addTx.origin()) ||
            !this.validation.validateTx(height, addTx.tx())) {
            return;
        }
        this.current.set(addTx.origin(), addTx.tx());
        this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
        clearTimeout(this.timeoutProposeBlock);
        this.timeoutProposeBlock = setTimeout(() => {
            this.block = block_1.Block.make(this.blockchain.getLatestBlock(), this.arrayPoolTx);
            this.block.votes.push({
                origin: this.wallet.getPublicKey(),
                sig: this.wallet.sign(this.block.hash),
            });
            this.network.broadcast(new propose_block_1.ProposeBlock().create(this.wallet, this.block));
        }, (this.network.getArrayNetwork().length - this.arrayPoolTx.length) * 250);
    }
    processProposeBlock(proposeBlock) {
        if (proposeBlock.height() !== this.blockchain.getHeight() + 1 ||
            proposeBlock.block().previousHash !== this.blockchain.getLatestBlock().hash ||
            !this.validation.validateBlock(proposeBlock.block(), false)) {
            return;
        }
        this.block = proposeBlock.block();
        this.calcValidator();
        const sb = new sign_block_1.SignBlock().create(this.wallet, this.validator, this.block.hash);
        this.isValidator() ? this.processSignBlock(sb) : this.network.broadcast(sb);
        this.setupRetry();
    }
    processSignBlock(signBlock) {
        if (this.block.hash !== signBlock.hash() ||
            this.block.votes.length >= this.blockchain.getQuorum() ||
            this.block.votes.some((v) => v.origin === signBlock.origin())) {
            return;
        }
        if (this.block.votes.push({ origin: signBlock.origin(), sig: signBlock.sig() }) >= this.blockchain.getQuorum()) {
            this.network.broadcast(new confirm_block_1.ConfirmBlock().create(this.wallet, this.block.hash, this.block.votes));
            this.addBlock(this.block);
        }
    }
    processConfirmBlock(confirmBlock) {
        if (!this.hasBlock() || this.block.hash !== confirmBlock.hash()) {
            return;
        }
        this.block.votes = confirmBlock.votes();
        this.addBlock(this.block);
    }
    processStatus(status) {
        let a;
        const h = this.blockchain.getHeight();
        switch (status.status()) {
            case status_1.ONLINE:
                if (!this.isSyncing && h < status.height()) {
                    this.isSyncing = true;
                    (async () => {
                        ((await this.network.fetchFromApi('sync/' + (h + 1))) || []).forEach((block) => {
                            this.addBlock(block);
                        });
                        this.isSyncing = false;
                    })();
                }
                a = this.mapAvailability.get(status.origin()) || [];
                a.push(Date.now());
                if (a.length >= config_1.STAKE_PING_SAMPLE_SIZE) {
                    const qc = util_1.Util.QuartileCoeff(a);
                    if (qc >= config_1.STAKE_PING_QUARTILE_COEFF_MIN && qc <= config_1.STAKE_PING_QUARTILE_COEFF_MAX) {
                        this.server.proposeModifyStake(status.origin(), config_1.STAKE_PING_IDENT, config_1.STAKE_PING_AMOUNT);
                    }
                    a = a.slice(-1 * Math.floor((a.length / 3) * 2));
                }
                this.mapAvailability.set(status.origin(), a);
                break;
            case status_1.OFFLINE:
                logger_1.Logger.trace(`${this.config.port}: OFFLINE status`);
                break;
            default:
                logger_1.Logger.warn(`${this.config.port}: Unknown status: ${status.status()}`);
        }
    }
    addBlock(block) {
        if (!this.blockchain.add(block)) {
            logger_1.Logger.error(`${this.config.port}: addBlock failed - ${block.height}`);
        }
        this.clear(block);
        this.calcValidator();
        this.timeoutAddTx = setTimeout(() => {
            this.doAddTx();
        }, 50);
        this.server.feedBlock(block);
        this.mapValidatorDist.set(this.validator, (this.mapValidatorDist.get(this.validator) || 0) + 1);
    }
    clear(block = {}) {
        this.removeTimeout();
        if (this.ownTx.height &&
            (!block.height ||
                !block.tx.some((t) => {
                    return t.sig === this.ownTx.tx.sig;
                }))) {
            this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
        }
        this.ownTx = {};
        this.current = new Map();
        this.arrayPoolTx = [];
        this.block = {};
    }
    setupRetry() {
        clearTimeout(this.timeoutRetry);
        this.timeoutRetry = setTimeout(() => {
            logger_1.Logger.trace(`${this.config.port} ${this.wallet.getPublicKey()}: RETRY`);
            this.clear();
            this.network.cleanMapOnline();
            this.doAddTx();
        }, this.config.block_retry_timeout_ms * this.network.getArrayNetwork().length);
    }
    removeTimeout() {
        clearTimeout(this.timeoutAddTx);
        clearTimeout(this.timeoutProposeBlock);
        clearTimeout(this.timeoutRetry);
    }
}
exports.BlockFactory = BlockFactory;
