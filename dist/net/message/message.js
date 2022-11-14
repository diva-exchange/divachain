"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const rfc4648_1 = require("rfc4648");
const zlib_1 = __importDefault(require("zlib"));
const util_1 = require("../../chain/util");
const logger_1 = require("../../logger");
class Message {
    constructor(msg) {
        this.message = {};
        this.msg = msg || Buffer.from('');
        if (this.msg.length > 0) {
            this._unpack();
        }
    }
    init(origin, dest = '') {
        this.message.seq = Date.now();
        this.message.origin = origin;
        this.message.dest = dest;
    }
    asBuffer() {
        return this.msg;
    }
    getMessage() {
        return this.message;
    }
    type() {
        return this.message.data.type || 0;
    }
    seq() {
        return this.message.seq;
    }
    origin() {
        return this.message.origin;
    }
    dest() {
        return this.message.dest;
    }
    pack(wallet, version = Message.VERSION) {
        const s = rfc4648_1.base64url.stringify(zlib_1.default.deflateRawSync(JSON.stringify(this.message)));
        switch (version) {
            case Message.VERSION_4:
                this.msg = Buffer.from(version + ';' + s + ';' + wallet.sign(s) + '\n');
                return this.msg;
            default:
                throw new Error('Message.pack(): unsupported data version');
        }
    }
    _unpack() {
        let version = 0;
        let message = '';
        let sig = '';
        const m = this.msg
            .toString()
            .trim()
            .match(/^([0-9]+);([^;]+);([A-Za-z0-9_-]{86})$/);
        if (m && m.length === 4) {
            version = Number(m[1]);
            message = m[2];
            sig = m[3];
        }
        switch (version) {
            case Message.VERSION_4:
                try {
                    this.message = JSON.parse(zlib_1.default.inflateRawSync(rfc4648_1.base64url.parse(message)).toString());
                    if (!this.message.origin || !util_1.Util.verifySignature(this.message.origin, sig, message)) {
                        this.message = {};
                    }
                }
                catch (error) {
                    this.message = {};
                }
                break;
            default:
                logger_1.Logger.warn(`Message.unpack(): unsupported data version ${version}, length: ${this.msg.length}`);
                logger_1.Logger.trace(this.msg.toString());
        }
    }
}
exports.Message = Message;
Message.VERSION_4 = 4;
Message.VERSION = Message.VERSION_4;
Message.TYPE_ADD_TX = 1;
Message.TYPE_PROPOSE_BLOCK = 2;
Message.TYPE_SIGN_BLOCK = 3;
Message.TYPE_CONFIRM_BLOCK = 4;
Message.TYPE_STATUS = 5;
