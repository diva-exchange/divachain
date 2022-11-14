"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignBlock = void 0;
const message_1 = require("./message");
class SignBlock extends message_1.Message {
    create(wallet, dest, hash) {
        this.init(wallet.getPublicKey(), dest);
        this.message.data = {
            type: message_1.Message.TYPE_SIGN_BLOCK,
            hash: hash,
            sig: wallet.sign(hash),
        };
        this.pack(wallet);
        return this;
    }
    hash() {
        return this.message.data.hash;
    }
    sig() {
        return this.message.data.sig;
    }
}
exports.SignBlock = SignBlock;
