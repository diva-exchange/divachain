"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Proposal = void 0;
const message_1 = require("./message");
const util_1 = require("../../chain/util");
class Proposal extends message_1.Message {
    create(wallet, height, tx) {
        const seq = Date.now();
        this.message.data = {
            type: message_1.Message.TYPE_PROPOSAL,
            seq: seq,
            origin: wallet.getPublicKey(),
            height: height,
            tx: tx,
            sig: wallet.sign([message_1.Message.TYPE_PROPOSAL, seq, height, JSON.stringify(tx)].join()),
        };
        return this;
    }
    get() {
        return this.message.data;
    }
    static isValid(structProposal) {
        return util_1.Util.verifySignature(structProposal.origin, structProposal.sig, [structProposal.type, structProposal.seq, structProposal.height, JSON.stringify(structProposal.tx)].join());
    }
}
exports.Proposal = Proposal;
