"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmBlock = void 0;
const message_1 = require("./message");
class ConfirmBlock extends message_1.Message {
    create(wallet, hash, votes) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_CONFIRM_BLOCK,
            hash: hash,
            votes: votes,
        };
        this.pack(wallet);
        return this;
    }
    hash() {
        return this.message.data.hash;
    }
    votes() {
        return this.message.data.votes;
    }
}
exports.ConfirmBlock = ConfirmBlock;
