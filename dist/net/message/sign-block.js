"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignBlock = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class SignBlock extends message_1.Message {
    create(wallet, dest, hash) {
        this.init(wallet.getPublicKey(), dest);
        this.message.data = {
            type: message_1.Message.TYPE_SIGN_BLOCK,
            hash: hash,
            sigBlock: wallet.sign(hash),
        };
        this.message.sig = wallet.sign([message_1.Message.TYPE_SIGN_BLOCK, this.message.seq, hash].join());
        return this;
    }
    hash() {
        return this.message.data.hash;
    }
    sigBlock() {
        return this.message.data.sigBlock;
    }
    static isValid(signBlock) {
        return util_1.Util.verifySignature(signBlock.origin(), signBlock.sig(), [signBlock.type(), signBlock.seq(), signBlock.hash()].join());
    }
}
exports.SignBlock = SignBlock;
