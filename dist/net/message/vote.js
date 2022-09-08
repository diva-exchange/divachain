"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vote = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Vote extends message_1.Message {
    create(wallet, height, txlength, hash) {
        const seq = Date.now();
        this.message.data = {
            type: message_1.Message.TYPE_VOTE,
            seq: seq,
            origin: wallet.getPublicKey(),
            height: height,
            txlength: txlength,
            hash: hash,
            sig: wallet.sign([height, hash].join()),
            sigMsg: wallet.sign([message_1.Message.TYPE_VOTE, seq, height, txlength, hash].join()),
        };
        return this;
    }
    get() {
        return this.message.data;
    }
    static isValid(structVote) {
        return util_1.Util.verifySignature(structVote.origin, structVote.sigMsg, [structVote.type, structVote.seq, structVote.height, structVote.txlength, structVote.hash].join());
    }
}
exports.Vote = Vote;
