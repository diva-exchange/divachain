"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Challenge = void 0;
const message_1 = require("./message");
class Challenge extends message_1.Message {
    create(challenge) {
        this.message.data = { type: message_1.Message.TYPE_CHALLENGE, challenge: challenge };
        return this;
    }
    getChallenge() {
        return this.message.data.challenge;
    }
}
exports.Challenge = Challenge;
