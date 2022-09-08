"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Util = void 0;
const rfc4648_1 = require("rfc4648");
const sodium_native_1 = __importDefault(require("sodium-native"));
class Util {
    static hash(s) {
        const bufferOutput = Buffer.alloc(sodium_native_1.default.crypto_hash_sha256_BYTES);
        sodium_native_1.default.crypto_hash_sha256(bufferOutput, Buffer.from(s));
        return rfc4648_1.base64url.stringify(bufferOutput, { pad: false });
    }
    static verifySignature(publicKey, sig, data) {
        try {
            return sodium_native_1.default.crypto_sign_verify_detached(rfc4648_1.base64url.parse(sig, { loose: true }), Buffer.from(data), rfc4648_1.base64url.parse(publicKey, { loose: true }));
        }
        catch (error) {
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
