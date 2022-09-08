"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
class Transaction {
    constructor(wallet, height, ident, commands) {
        this.structTransaction = {
            ident: ident,
            origin: wallet.getPublicKey(),
            commands: commands,
            sig: wallet.sign(height + JSON.stringify(commands)),
        };
    }
    get() {
        return this.structTransaction;
    }
}
exports.Transaction = Transaction;
