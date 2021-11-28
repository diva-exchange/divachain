"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lock = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Lock extends message_1.Message {
    create(round, origin, height, tx, sig) {
        const structLock = {
            type: Lock.TYPE_LOCK,
            origin: origin,
            height: height,
            tx: tx,
            sig: sig,
        };
        this.message.ident = [round, structLock.type, structLock.sig].join();
        this.message.data = structLock;
        return this;
    }
    get() {
        return this.message.data;
    }
    static isValid(structLock) {
        return util_1.Util.verifySignature(structLock.origin, structLock.sig, util_1.Util.hash([structLock.height, structLock.tx.reduce((s, t) => s + t.sig, '')].join()));
    }
}
exports.Lock = Lock;
