'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pool = void 0;
const transaction_1 = require("../chain/transaction");
const block_1 = require("../chain/block");
const nanoid_1 = require("nanoid");
const util_1 = require("../chain/util");
const lock_1 = require("./message/lock");
const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;
class Pool {
    constructor(server) {
        this.stackTransaction = [];
        this.ownTx = {};
        this.current = new Map();
        this.currentHash = '';
        this.arrayTransaction = [];
        this.heightCurrent = 0;
        this.stakeLock = 0;
        this.roundLock = 0;
        this.block = {};
        this.mapVote = new Map();
        this.server = server;
    }
    static make(server) {
        return new Pool(server);
    }
    initHeight() {
        if (!this.heightCurrent) {
            this.heightCurrent = this.server.getBlockchain().getHeight() + 1;
        }
    }
    stack(ident, commands) {
        ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : (0, nanoid_1.nanoid)(DEFAULT_LENGTH_IDENT);
        const tx = new transaction_1.Transaction(this.server.getWallet(), 1, ident, commands).get();
        if (this.server.getValidation().validateTx(1, tx) &&
            this.stackTransaction.push({ ident: ident, commands: commands }) > 0) {
            return ident;
        }
        return false;
    }
    release() {
        if (this.hasBlock() || this.ownTx.height || !this.stackTransaction.length) {
            return false;
        }
        const r = this.stackTransaction.shift();
        this.ownTx = {
            height: this.heightCurrent,
            tx: new transaction_1.Transaction(this.server.getWallet(), this.heightCurrent, r.ident, r.commands).get(),
        };
        this.current.set(this.server.getWallet().getPublicKey(), this.ownTx.tx);
        this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1));
        this.currentHash = util_1.Util.hash([this.heightCurrent, this.arrayTransaction.reduce((s, t) => s + t.sig, '')].join());
        return true;
    }
    hasTransactions() {
        return this.current.size > 0;
    }
    getStack() {
        return this.stackTransaction;
    }
    getArrayLocks() {
        return [...this.current.keys()];
    }
    add(structLock) {
        if (structLock.height !== this.heightCurrent || this.hasBlock()) {
            return false;
        }
        let aTx = structLock.tx.filter((_tx) => {
            return this.server.getValidation().validateTx(structLock.height, _tx);
        });
        const hash = util_1.Util.hash([this.heightCurrent, aTx.reduce((s, t) => s + t.sig, '')].join());
        if (hash !== this.currentHash) {
            aTx = aTx.filter((_tx) => {
                return !this.current.has(_tx.origin);
            });
            if (!aTx.length) {
                return true;
            }
            aTx.forEach((tx) => {
                this.current.set(tx.origin, tx);
            });
            this.arrayTransaction = [...this.current.values()].sort((a, b) => (a.origin > b.origin ? 1 : -1));
            this.currentHash = util_1.Util.hash([this.heightCurrent, this.arrayTransaction.reduce((s, t) => s + t.sig, '')].join());
            this.stakeLock = this.server.getBlockchain().getStake(structLock.origin);
            this.mapVote = new Map();
            this.mapVote.set(structLock.origin, structLock.sig);
            this.roundLock = 0;
        }
        else if (!this.mapVote.has(structLock.origin)) {
            this.stakeLock += this.server.getBlockchain().getStake(structLock.origin);
            this.mapVote.set(structLock.origin, structLock.sig);
            if (this.stakeLock >= this.server.getBlockchain().getQuorum()) {
                if (this.roundLock++ >= 2) {
                    this.block = block_1.Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayTransaction);
                    this.mapVote.forEach((sig, origin) => {
                        this.block.votes.push({ origin: origin, sig: sig });
                    });
                }
                else {
                    this.stakeLock = 0;
                    this.mapVote = new Map();
                }
                console.debug(`Round: ${this.roundLock} - ${this.currentHash}`);
            }
        }
        return true;
    }
    getBlock() {
        return this.block.hash ? this.block : {};
    }
    getLock() {
        return new lock_1.Lock().create(this.roundLock, this.server.getWallet().getPublicKey(), this.heightCurrent, this.arrayTransaction, this.server.getWallet().sign(this.currentHash));
    }
    hasBlock() {
        return !!this.block.hash;
    }
    clear(block) {
        if (this.ownTx.height &&
            !block.tx.some((t) => {
                return t.sig === this.ownTx.tx.sig;
            })) {
            this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
        }
        this.ownTx = {};
        this.heightCurrent = block.height + 1;
        this.current = new Map();
        this.arrayTransaction = [];
        this.currentHash = '';
        this.block = {};
        this.mapVote = new Map();
        this.stakeLock = 0;
        this.roundLock = 0;
    }
}
exports.Pool = Pool;
