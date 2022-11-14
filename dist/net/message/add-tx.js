"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddTx = void 0;
const message_1 = require("./message");
class AddTx extends message_1.Message {
    create(wallet, dest, height, tx) {
        this.init(wallet.getPublicKey(), dest);
        this.message.data = {
            type: message_1.Message.TYPE_ADD_TX,
            height: height,
            tx: tx,
        };
        this.pack(wallet);
        return this;
    }
    height() {
        return this.message.data.height;
    }
    tx() {
        return this.message.data.tx;
    }
}
exports.AddTx = AddTx;
