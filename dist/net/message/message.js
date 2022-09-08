"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const rfc4648_1 = require("rfc4648");
const nanoid_1 = require("nanoid");
const zlib_1 = __importDefault(require("zlib"));
const DEFAULT_NANOID_LENGTH = 10;
class Message {
    constructor(message) {
        this.message = {};
        if (message) {
            this._unpack(message);
        }
    }
    getMessage() {
        return this.message;
    }
    type() {
        return this.message.data.type;
    }
    seq() {
        return this.message.data.seq;
    }
    origin() {
        return this.message.data.origin;
    }
    pack(version) {
        this.message.ident = this.message.ident || [this.message.data.type, (0, nanoid_1.nanoid)(DEFAULT_NANOID_LENGTH)].join();
        return this._pack(version);
    }
    _pack(version = Message.VERSION) {
        switch (version) {
            case Message.VERSION_2:
                return version + ';' + rfc4648_1.base64url.stringify(Buffer.from(JSON.stringify(this.message))) + '\n';
            case Message.VERSION_3:
                return version + ';' + rfc4648_1.base64url.stringify(zlib_1.default.deflateRawSync(JSON.stringify(this.message))) + '\n';
        }
        throw new Error('Message.pack(): unsupported data version');
    }
    _unpack(input) {
        let version = 0;
        let message = '';
        const m = input
            .toString()
            .trim()
            .match(/^([0-9]+);(.+)$/);
        if (m && m.length === 3) {
            version = Number(m[1]);
            message = m[2];
        }
        switch (version) {
            case Message.VERSION_2:
                this.message = JSON.parse(rfc4648_1.base64url.parse(message).toString());
                break;
            case Message.VERSION_3:
                this.message = JSON.parse(zlib_1.default.inflateRawSync(rfc4648_1.base64url.parse(message)).toString());
                break;
            default:
                throw new Error(`Message.unpack(): unsupported data version ${version}`);
        }
    }
}
exports.Message = Message;
Message.VERSION_2 = 2;
Message.VERSION_3 = 3;
Message.VERSION = Message.VERSION_3;
Message.TYPE_PROPOSAL = 1;
Message.TYPE_VOTE = 2;
Message.TYPE_SYNC = 3;
