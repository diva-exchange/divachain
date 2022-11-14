"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposeBlock = void 0;
const message_1 = require("./message");
class ProposeBlock extends message_1.Message {
    create(wallet, block) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_PROPOSE_BLOCK,
            block: block,
        };
        this.pack(wallet);
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
}
exports.ProposeBlock = ProposeBlock;
