"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wallet = exports.NAME_HEADER_TOKEN_API = void 0;
const sodium_native_1 = __importDefault(require("sodium-native"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const rfc4648_1 = require("rfc4648");
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
const nanoid_1 = require("nanoid");
const crypto_1 = __importDefault(require("crypto"));
exports.NAME_HEADER_TOKEN_API = 'diva-token-api';
const DEFAULT_LENGTH_TOKEN_API = 32;
class Wallet {
    constructor(config) {
        this.ident = '';
        this.tokenAPI = '';
        this.config = config;
        this.publicKey = Buffer.alloc(sodium_native_1.default.crypto_sign_PUBLICKEYBYTES);
        this.secretKey = sodium_native_1.default.sodium_malloc(sodium_native_1.default.crypto_sign_SECRETKEYBYTES);
        this.createTokenAPI();
    }
    static make(config) {
        return new Wallet(config);
    }
    createTokenAPI() {
        const p = path_1.default.join(this.config.path_keys, (0, i2p_sam_1.toB32)(this.config.http) + '.token');
        fs_1.default.writeFileSync(p, (0, nanoid_1.nanoid)(DEFAULT_LENGTH_TOKEN_API), { mode: '0600' });
        this.tokenAPI = fs_1.default.readFileSync(p).toString();
        setTimeout(() => {
            this.createTokenAPI();
        }, crypto_1.default.randomInt(180000, 600000));
    }
    getTokenAPI() {
        return this.tokenAPI;
    }
    open() {
        this.ident = (0, i2p_sam_1.toB32)(this.config.http) + '.wallet';
        sodium_native_1.default.sodium_mlock(this.secretKey);
        const pathPublic = path_1.default.join(this.config.path_keys, this.ident + '.public');
        const pathSecret = path_1.default.join(this.config.path_keys, this.ident + '.private');
        if (fs_1.default.existsSync(pathPublic) && fs_1.default.existsSync(pathSecret)) {
            this.publicKey.fill(fs_1.default.readFileSync(pathPublic));
            this.secretKey.fill(fs_1.default.readFileSync(pathSecret));
        }
        else {
            sodium_native_1.default.crypto_sign_keypair(this.publicKey, this.secretKey);
            fs_1.default.writeFileSync(pathPublic, this.publicKey, { mode: '0644' });
            fs_1.default.writeFileSync(pathSecret, this.secretKey, { mode: '0600' });
        }
        return this;
    }
    close() {
        sodium_native_1.default.sodium_munlock(this.secretKey);
    }
    sign(data) {
        if (!this.ident) {
            this.open();
        }
        const bufferSignature = Buffer.alloc(sodium_native_1.default.crypto_sign_BYTES);
        sodium_native_1.default.crypto_sign_detached(bufferSignature, Buffer.from(data), this.secretKey);
        return rfc4648_1.base64url.stringify(bufferSignature, { pad: false });
    }
    getPublicKey() {
        if (!this.ident) {
            this.open();
        }
        return rfc4648_1.base64url.stringify(this.publicKey, { pad: false });
    }
}
exports.Wallet = Wallet;
