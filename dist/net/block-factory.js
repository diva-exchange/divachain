"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockFactory = void 0;
const transaction_1 = require("../chain/transaction");
const nanoid_1 = require("nanoid");
const add_tx_1 = require("./message/add-tx");
const logger_1 = require("../logger");
const block_1 = require("../chain/block");
const message_1 = require("./message/message");
const sync_1 = require("./message/sync");
const propose_block_1 = require("./message/propose-block");
const sign_block_1 = require("./message/sign-block");
const confirm_block_1 = require("./message/confirm-block");
const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;
class BlockFactory {
    constructor(server) {
        this.stackTransaction = [];
        this.ownTx = {};
        this.current = new Map();
        this.arrayPoolTx = [];
        this.block = {};
        this.timeoutAddTx = {};
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
    getValidator() {
        const i = (this.blockchain.getHeight() + 1) % this.network.getArrayNetwork().length;
        return this.network.getArrayNetwork()[i].publicKey;
    }
    isValidator(origin = this.wallet.getPublicKey()) {
        return origin === this.getValidator();
    }
    stack(commands, ident = '') {
        const height = this.blockchain.getHeight() + 1;
        ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : (0, nanoid_1.nanoid)(DEFAULT_LENGTH_IDENT);
        if (!this.validation.validateTx(height, new transaction_1.Transaction(this.wallet, height, ident, commands).get())) {
            return false;
        }
        this.stackTransaction.push({ ident: ident, commands: commands });
        setImmediate(() => {
            this.doAddTx();
        });
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
                this.isValidator() && this.processAddTx(new add_tx_1.AddTx(m.pack()));
                break;
            case message_1.Message.TYPE_PROPOSE_BLOCK:
                this.isValidator(m.origin()) && this.processProposeBlock(new propose_block_1.ProposeBlock(m.pack()));
                break;
            case message_1.Message.TYPE_SIGN_BLOCK:
                this.isValidator() && this.processSignBlock(new sign_block_1.SignBlock(m.pack()));
                break;
            case message_1.Message.TYPE_CONFIRM_BLOCK:
                this.isValidator(m.origin()) && this.processConfirmBlock(new confirm_block_1.ConfirmBlock(m.pack()));
                break;
            case message_1.Message.TYPE_SYNC:
                this.processSync(new sync_1.Sync(m.pack()));
                break;
            default:
                throw new Error('Invalid message type');
        }
    }
    doAddTx() {
        const height = this.blockchain.getHeight() + 1;
        while (!this.ownTx.height && this.stackTransaction.length) {
            const r = this.stackTransaction.shift();
            const tx = new transaction_1.Transaction(this.wallet, height, r.ident, r.commands).get();
            if (this.validation.validateTx(height, tx)) {
                this.ownTx = {
                    height: height,
                    tx: tx,
                };
                const atx = new add_tx_1.AddTx().create(this.wallet, this.getValidator(), height, tx);
                this.isValidator() ? this.processAddTx(atx) : this.network.broadcast(atx);
            }
        }
    }
    processAddTx(addTx) {
        const height = this.blockchain.getHeight() + 1;
        if (this.hasBlock() ||
            addTx.height() !== height ||
            this.current.has(addTx.origin()) ||
            !this.validation.validateTx(height, addTx.tx()) ||
            !add_tx_1.AddTx.isValid(addTx)) {
            return;
        }
        this.current.set(addTx.origin(), addTx.tx());
        this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
        clearTimeout(this.timeoutAddTx);
        this.timeoutAddTx = setTimeout(() => {
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
            !propose_block_1.ProposeBlock.isValid(proposeBlock) ||
            !this.validation.validateBlock(proposeBlock.block(), false)) {
            return;
        }
        this.block = proposeBlock.block();
        this.network.broadcast(new sign_block_1.SignBlock().create(this.wallet, this.getValidator(), this.block.hash));
    }
    processSignBlock(signBlock) {
        if (this.block.hash !== signBlock.hash() ||
            this.block.votes.length >= this.blockchain.getQuorum() ||
            this.block.votes.some((v) => v.origin === signBlock.origin()) ||
            !sign_block_1.SignBlock.isValid(signBlock)) {
            return;
        }
        if (this.block.votes.push({ origin: signBlock.origin(), sig: signBlock.sigBlock() }) >= this.blockchain.getQuorum()) {
            this.network.broadcast(new confirm_block_1.ConfirmBlock().create(this.wallet, this.block.hash, this.block.votes));
            this.addBlock(this.block);
        }
    }
    processConfirmBlock(confirmBlock) {
        if (!this.hasBlock() || !confirm_block_1.ConfirmBlock.isValid(confirmBlock) || this.block.hash !== confirmBlock.hash()) {
            return;
        }
        this.block.votes = confirmBlock.votes();
        this.addBlock(this.block);
    }
    processSync(sync) {
        if (this.blockchain.getHeight() + 1 === sync.block().height) {
            this.addBlock(sync.block());
        }
    }
    addBlock(block) {
        if (!this.blockchain.add(block)) {
            logger_1.Logger.trace(`${JSON.stringify(block)}`);
            throw new Error(`${this.config.port}: addBlock failed`);
        }
        this.clear(block);
        this.server.feedBlock(block);
        setImmediate(() => {
            this.doAddTx();
        });
    }
    clear(block) {
        if (this.ownTx.height &&
            !block.tx.some((t) => {
                return t.sig === this.ownTx.tx.sig;
            })) {
            this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
        }
        this.ownTx = {};
        this.current = new Map();
        this.arrayPoolTx = [];
        this.block = {};
    }
}
exports.BlockFactory = BlockFactory;
