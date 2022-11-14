"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Status = exports.OFFLINE = exports.ONLINE = void 0;
const message_1 = require("./message");
exports.ONLINE = 1;
exports.OFFLINE = 2;
class Status extends message_1.Message {
    create(wallet, status, height) {
        this.init(wallet.getPublicKey());
        this.message.data = {
            type: message_1.Message.TYPE_STATUS,
            status: status,
            height: height,
        };
        this.pack(wallet);
        return this;
    }
    status() {
        return this.message.data.status;
    }
    height() {
        return this.message.data.height;
    }
}
exports.Status = Status;
