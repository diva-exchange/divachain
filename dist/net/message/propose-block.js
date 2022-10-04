"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposeBlock = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class ProposeBlock extends message_1.Message {
    create(wallet, block) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_PROPOSE_BLOCK,
            block: block,
        };
        this.message.sig = wallet.sign([message_1.Message.TYPE_PROPOSE_BLOCK, this.message.seq, block.hash].join());
        return this;
    }
    block() {
        return this.message.data.block;
    }
    hash() {
        return this.message.data.block.hash;
    }
    height() {
        return this.message.data.block.height;
    }
    static isValid(proposeBlock) {
        return util_1.Util.verifySignature(proposeBlock.origin(), proposeBlock.sig(), [proposeBlock.type(), proposeBlock.seq(), proposeBlock.hash()].join());
    }
}
exports.ProposeBlock = ProposeBlock;
