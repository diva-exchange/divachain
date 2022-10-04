"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmBlock = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class ConfirmBlock extends message_1.Message {
    create(wallet, hash, votes) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_CONFIRM_BLOCK,
            hash: hash,
            votes: votes,
        };
        this.message.sig = wallet.sign([message_1.Message.TYPE_CONFIRM_BLOCK, this.message.seq, hash, JSON.stringify(votes)].join());
        return this;
    }
    hash() {
        return this.message.data.hash;
    }
    votes() {
        return this.message.data.votes;
    }
    static isValid(confirmBlock) {
        return util_1.Util.verifySignature(confirmBlock.origin(), confirmBlock.sig(), [confirmBlock.type(), confirmBlock.seq(), confirmBlock.hash(), JSON.stringify(confirmBlock.votes())].join());
    }
}
exports.ConfirmBlock = ConfirmBlock;
