"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Block = void 0;
const util_1 = require("./util");
const config_1 = require("../config");
class Block {
    constructor(previousBlock, tx) {
        this.previousBlock = previousBlock;
        this.version = config_1.BLOCK_VERSION;
        this.previousHash = previousBlock.hash;
        this.height = previousBlock.height + 1;
        this.tx = tx;
        this.hash = util_1.Util.hash([this.version, this.previousHash, JSON.stringify(this.tx), this.height].join());
    }
    static make(previousBlock, tx) {
        return new Block(previousBlock, tx).get();
    }
    get() {
        return {
            version: this.version,
            previousHash: this.previousHash,
            hash: this.hash,
            tx: this.tx,
            height: this.height,
            votes: [],
        };
    }
}
exports.Block = Block;
