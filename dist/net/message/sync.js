"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Sync extends message_1.Message {
    create(wallet, block) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_SYNC,
            block: block,
        };
        this.message.sig = wallet.sign([message_1.Message.TYPE_SYNC, this.message.seq, block.hash].join());
        return this;
    }
    block() {
        return this.message.data.block;
    }
    static isValid(sync) {
        return util_1.Util.verifySignature(sync.origin(), sync.sig(), [sync.type(), sync.seq(), sync.block().hash].join());
    }
}
exports.Sync = Sync;
