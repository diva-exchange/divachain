"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Auth extends message_1.Message {
    create(sig) {
        this.message.data = { type: message_1.Message.TYPE_AUTH, sig: sig };
        return this;
    }
    isValid(challenge, publicKey) {
        return util_1.Util.verifySignature(publicKey, this.message.data.sig, challenge);
    }
}
exports.Auth = Auth;
