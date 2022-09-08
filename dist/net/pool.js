'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pool = void 0;
const transaction_1 = require("../chain/transaction");
const block_1 = require("../chain/block");
const nanoid_1 = require("nanoid");
const util_1 = require("../chain/util");
const vote_1 = require("./message/vote");
const proposal_1 = require("./message/proposal");
const logger_1 = require("../logger");
const DEFAULT_LENGTH_IDENT = 8;
const MAX_LENGTH_IDENT = 32;
class Pool {
    constructor(server) {
        this.stackTransaction = [];
        this.ownTx = {};
        this.ownProposal = {};
        this.arrayPoolTx = [];
        this.current = new Map();
        this.currentHash = '';
        this.currentVote = {};
        this.mapVotes = new Map();
        this.block = {};
        this.server = server;
    }
    static make(server) {
        return new Pool(server);
    }
    stack(commands, ident = '') {
        const height = this.server.getBlockchain().getHeight() + 1;
        ident = ident && ident.length <= MAX_LENGTH_IDENT ? ident : (0, nanoid_1.nanoid)(DEFAULT_LENGTH_IDENT);
        if (!this.server
            .getValidation()
            .validateTx(height, new transaction_1.Transaction(this.server.getWallet(), height, ident, commands).get())) {
            return false;
        }
        this.stackTransaction.push({ ident: ident, commands: commands });
        return ident;
    }
    getStack() {
        return this.stackTransaction;
    }
    getOwnProposal() {
        const height = this.server.getBlockchain().getHeight() + 1;
        while (!this.ownTx.height && this.stackTransaction.length) {
            const r = this.stackTransaction.shift();
            const tx = new transaction_1.Transaction(this.server.getWallet(), height, r.ident, r.commands).get();
            if (this.server.getValidation().validateTx(height, tx)) {
                this.ownTx = {
                    height: height,
                    tx: tx,
                };
                this.updateOwnProposal();
            }
        }
        return this.ownTx.height > 0 ? this.ownProposal : false;
    }
    updateOwnProposal() {
        this.ownTx.height > 0 &&
            (this.ownProposal = new proposal_1.Proposal().create(this.server.getWallet(), this.ownTx.height, this.ownTx.tx));
    }
    propose(structProposal) {
        const height = this.server.getBlockchain().getHeight() + 1;
        if (structProposal.height !== height) {
            return false;
        }
        if (this.current.has(structProposal.origin) || !this.server.getValidation().validateTx(height, structProposal.tx)) {
            return false;
        }
        this.current.set(structProposal.origin, structProposal.tx);
        this.arrayPoolTx = [...this.current.values()].sort((a, b) => (a.sig > b.sig ? 1 : -1));
        this.currentHash = util_1.Util.hash(JSON.stringify(this.arrayPoolTx));
        this.currentVote = new vote_1.Vote().create(this.server.getWallet(), height, this.arrayPoolTx.length, this.currentHash);
        return true;
    }
    getCurrentVote() {
        if (this.current.size === 0) {
            return false;
        }
        return this.currentVote;
    }
    vote(structVote) {
        const height = this.server.getBlockchain().getHeight() + 1;
        if (structVote.height !== height) {
            return false;
        }
        const mapOrigins = this.mapVotes.get(structVote.txlength) || new Map();
        if (mapOrigins.has(structVote.origin)) {
            return false;
        }
        mapOrigins.set(structVote.origin, structVote);
        this.mapVotes.set(structVote.txlength, mapOrigins);
        const quorum = this.server.getBlockchain().getQuorum();
        if (structVote.txlength !== this.arrayPoolTx.length || mapOrigins.size < quorum) {
            return false;
        }
        const arrayVotes = [...mapOrigins.values()].filter((v) => v.hash === this.currentHash);
        if (arrayVotes.length >= quorum) {
            this.block = block_1.Block.make(this.server.getBlockchain().getLatestBlock(), this.arrayPoolTx);
            this.block.votes = arrayVotes.map((v) => {
                return { origin: v.origin, sig: v.sig };
            });
            return true;
        }
        if (arrayVotes.length + (quorum * 1.5 - mapOrigins.size) < quorum) {
            logger_1.Logger.trace(`${this.server.config.port}: deadlocked ${this.arrayPoolTx.length}`);
        }
        return false;
    }
    getArrayPoolTx() {
        return this.arrayPoolTx;
    }
    getArrayPoolVotes() {
        const a = [];
        this.mapVotes.forEach((v, txlength) => {
            a[txlength] = [];
            v.forEach((vs) => {
                a[txlength].push(vs);
            });
        });
        return a;
    }
    getBlock() {
        return this.block;
    }
    clear(block) {
        if (this.ownTx.height &&
            !block.tx.some((t) => {
                return t.sig === this.ownTx.tx.sig;
            })) {
            this.stackTransaction.unshift({ ident: this.ownTx.tx.ident, commands: this.ownTx.tx.commands });
        }
        this.ownTx = {};
        this.ownProposal = {};
        this.current = new Map();
        this.arrayPoolTx = [];
        this.currentHash = '';
        this.currentVote = {};
        this.mapVotes = new Map();
        this.block = {};
    }
}
exports.Pool = Pool;
