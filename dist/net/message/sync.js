"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = void 0;
const message_1 = require("./message");
class Sync extends message_1.Message {
    create(block) {
        const structSync = {
            type: message_1.Message.TYPE_SYNC,
            block: block,
        };
        this.message.ident = [structSync.type, block.height].join();
        this.message.data = structSync;
        return this;
    }
    get() {
        return this.message.data;
    }
}
exports.Sync = Sync;
