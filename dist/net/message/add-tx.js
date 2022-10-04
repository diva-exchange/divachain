"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddTx = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class AddTx extends message_1.Message {
    create(wallet, dest, height, tx) {
        this.init(wallet.getPublicKey(), dest);
        this.message.data = {
            type: message_1.Message.TYPE_ADD_TX,
            height: height,
            tx: tx,
        };
        this.message.sig = wallet.sign([message_1.Message.TYPE_ADD_TX, this.message.seq, height, JSON.stringify(tx)].join());
        return this;
    }
    height() {
        return this.message.data.height;
    }
    tx() {
        return this.message.data.tx;
    }
    static isValid(addTx) {
        return util_1.Util.verifySignature(addTx.origin(), addTx.sig(), [addTx.type(), addTx.seq(), addTx.height(), JSON.stringify(addTx.tx())].join());
    }
}
exports.AddTx = AddTx;
