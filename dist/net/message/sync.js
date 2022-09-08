"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Sync extends message_1.Message {
    create(wallet, block) {
        const seq = Date.now();
        this.message.data = {
            type: message_1.Message.TYPE_SYNC,
            seq: seq,
            origin: wallet.getPublicKey(),
            block: block,
            sig: wallet.sign([message_1.Message.TYPE_SYNC, seq, block.hash].join()),
        };
        return this;
    }
    get() {
        return this.message.data;
    }
    static isValid(structSync) {
        return util_1.Util.verifySignature(structSync.origin, structSync.sig, [structSync.type, structSync.seq, structSync.block.hash].join());
    }
}
exports.Sync = Sync;
