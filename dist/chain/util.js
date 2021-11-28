"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Util = void 0;
const base64url_1 = __importDefault(require("base64url"));
const sodium_native_1 = __importDefault(require("sodium-native"));
const logger_1 = require("../logger");
class Util {
    static hash(s) {
        const bufferOutput = Buffer.alloc(sodium_native_1.default.crypto_hash_sha256_BYTES);
        sodium_native_1.default.crypto_hash_sha256(bufferOutput, Buffer.from(s));
        return base64url_1.default.encode(bufferOutput.toString('binary'), 'binary');
    }
    static verifySignature(publicKey, sig, data) {
        try {
            return sodium_native_1.default.crypto_sign_verify_detached(Buffer.from(base64url_1.default.decode(sig, 'binary'), 'binary'), Buffer.from(data), Buffer.from(base64url_1.default.decode(publicKey, 'binary'), 'binary'));
        }
        catch (error) {
            logger_1.Logger.trace('Util.verifySignature() failed');
            console.trace(`${publicKey} / ${sig} / ${data}`);
            return false;
        }
    }
    static shuffleArray(array) {
        const a = array.slice();
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}
exports.Util = Util;
