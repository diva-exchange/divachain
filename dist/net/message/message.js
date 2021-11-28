"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const base64url_1 = __importDefault(require("base64url"));
const nanoid_1 = require("nanoid");
const zlib = __importStar(require("zlib"));
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
    ident() {
        return this.message.ident;
    }
    type() {
        return this.message.data.type;
    }
    origin() {
        return this.message.data.origin || '';
    }
    sig() {
        return this.message.data.sig || '';
    }
    hash() {
        return this.message.data.block ? this.message.data.block.hash : '';
    }
    pack(version) {
        this.message.ident = this.message.ident || [this.message.data.type, (0, nanoid_1.nanoid)(16)].join();
        return this._pack(version);
    }
    _pack(version = Message.VERSION) {
        switch (version) {
            case Message.VERSION_1:
                return version + ';' + JSON.stringify(this.message);
            case Message.VERSION_2:
                return version + ';' + base64url_1.default.encode(JSON.stringify(this.message));
            case Message.VERSION_3:
                return (version + ';' + base64url_1.default.encode(zlib.deflateRawSync(Buffer.from(JSON.stringify(this.message), 'binary'))));
        }
        throw new Error('Message.pack(): unsupported data version');
    }
    _unpack(input) {
        let version = 0;
        let message = '';
        const m = input.toString().match(/^([0-9]+);(.+)$/);
        if (m && m.length > 2) {
            version = Number(m[1]);
            message = m[2];
        }
        switch (version) {
            case Message.VERSION_1:
                this.message = JSON.parse(message);
                break;
            case Message.VERSION_2:
                this.message = JSON.parse(base64url_1.default.decode(message));
                break;
            case Message.VERSION_3:
                this.message = JSON.parse(zlib.inflateRawSync(base64url_1.default.decode(message)).toString('binary'));
                break;
            default:
                throw new Error(`Message.unpack(): unsupported data version ${version}`);
        }
    }
}
exports.Message = Message;
Message.VERSION_1 = 1;
Message.VERSION_2 = 2;
Message.VERSION_3 = 3;
Message.VERSION = Message.VERSION_2;
Message.TYPE_CHALLENGE = 1;
Message.TYPE_AUTH = 2;
Message.TYPE_LOCK = 3;
Message.TYPE_SYNC = 4;
