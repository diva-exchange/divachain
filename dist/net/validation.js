"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validation = void 0;
const ajv_1 = __importDefault(require("ajv"));
const message_1 = require("./message/message");
const logger_1 = require("../logger");
const path_1 = __importDefault(require("path"));
const util_1 = require("../chain/util");
const blockchain_1 = require("../chain/blockchain");
class Validation {
    constructor() {
        const pathSchema = path_1.default.join(__dirname, '../schema/');
        const schemaMessage = require(pathSchema + 'message/message.json');
        const schemaAuth = require(pathSchema + 'message/auth.json');
        const schemaChallenge = require(pathSchema + 'message/challenge.json');
        const schemaLock = require(pathSchema + 'message/lock.json');
        const schemaSync = require(pathSchema + 'message/sync.json');
        const schemaBlockV1 = require(pathSchema + 'block/v1/block.json');
        const schemaVotesV1 = require(pathSchema + 'block/v1/votes.json');
        const schemaTxV1 = require(pathSchema + 'block/v1/transaction/tx.json');
        const schemaAddPeerV1 = require(pathSchema + 'block/v1/transaction/add-peer.json');
        const schemaRemovePeerV1 = require(pathSchema +
            'block/v1/transaction/remove-peer.json');
        const schemaModifyStakeV1 = require(pathSchema +
            'block/v1/transaction/modify-stake.json');
        const schemaDataV1 = require(pathSchema + 'block/v1/transaction/data.json');
        const schemaDecisionV1 = require(pathSchema + 'block/v1/transaction/decision.json');
        const schemaBlockV2 = require(pathSchema + 'block/v2/block.json');
        const schemaVotesV2 = require(pathSchema + 'block/v2/votes.json');
        const schemaTxV2 = require(pathSchema + 'block/v2/transaction/tx.json');
        const schemaAddPeerV2 = require(pathSchema + 'block/v2/transaction/add-peer.json');
        const schemaRemovePeerV2 = require(pathSchema +
            'block/v2/transaction/remove-peer.json');
        const schemaModifyStakeV2 = require(pathSchema +
            'block/v2/transaction/modify-stake.json');
        const schemaDataDecisionV2 = require(pathSchema +
            'block/v2/transaction/data-decision.json');
        const schemaBlockV3 = require(pathSchema + 'block/v3/block.json');
        const schemaVotesV3 = require(pathSchema + 'block/v3/votes.json');
        const schemaTxV3 = require(pathSchema + 'block/v3/transaction/tx.json');
        const schemaAddPeerV3 = require(pathSchema + 'block/v3/transaction/add-peer.json');
        const schemaRemovePeerV3 = require(pathSchema +
            'block/v3/transaction/remove-peer.json');
        const schemaModifyStakeV3 = require(pathSchema +
            'block/v3/transaction/modify-stake.json');
        const schemaDataDecisionV3 = require(pathSchema +
            'block/v3/transaction/data-decision.json');
        this.message = new ajv_1.default({
            schemas: [
                schemaAuth,
                schemaChallenge,
                schemaLock,
                schemaSync,
                schemaBlockV1,
                schemaVotesV1,
                schemaTxV1,
                schemaAddPeerV1,
                schemaRemovePeerV1,
                schemaModifyStakeV1,
                schemaDataV1,
                schemaDecisionV1,
                schemaBlockV2,
                schemaVotesV2,
                schemaTxV2,
                schemaAddPeerV2,
                schemaRemovePeerV2,
                schemaModifyStakeV2,
                schemaDataDecisionV2,
                schemaBlockV3,
                schemaVotesV3,
                schemaTxV3,
                schemaAddPeerV3,
                schemaRemovePeerV3,
                schemaModifyStakeV3,
                schemaDataDecisionV3,
            ],
        }).compile(schemaMessage);
    }
    static make() {
        return new Validation();
    }
    validateMessage(m) {
        switch (m.type()) {
            case message_1.Message.TYPE_AUTH:
            case message_1.Message.TYPE_CHALLENGE:
            case message_1.Message.TYPE_LOCK:
            case message_1.Message.TYPE_SYNC:
                if (!this.message(m.getMessage())) {
                    logger_1.Logger.trace('Validation.validateMessage() failed');
                    logger_1.Logger.trace(`${JSON.stringify(m)}`);
                    logger_1.Logger.trace(`${JSON.stringify(this.message.errors)}`);
                    return false;
                }
                return true;
            default:
                logger_1.Logger.trace('Unknown message type');
                return false;
        }
    }
    validateBlock(structBlock) {
        const { version, previousHash, hash, height, tx, votes } = structBlock;
        let _aOrigin;
        _aOrigin = [];
        for (const vote of votes) {
            if (_aOrigin.includes(vote.origin)) {
                logger_1.Logger.trace(`Validation.validateBlock() - Multiple votes from same origin: ${height}`);
                return false;
            }
            _aOrigin.push(vote.origin);
        }
        _aOrigin = [];
        for (const transaction of tx) {
            if (_aOrigin.includes(transaction.origin)) {
                logger_1.Logger.trace(`Validation.validateBlock() - Multiple transactions from same origin: ${height}`);
                return false;
            }
            _aOrigin.push(transaction.origin);
            if (!this.validateTx(height, transaction)) {
                logger_1.Logger.trace(`Validation.validateBlock() - invalid tx: ${height}`);
                return false;
            }
        }
        return util_1.Util.hash(previousHash + version + height + JSON.stringify(tx)) === hash;
    }
    validateTx(height, tx) {
        return (Array.isArray(tx.commands) &&
            util_1.Util.verifySignature(tx.origin, tx.sig, height + JSON.stringify(tx.commands)) &&
            tx.commands.filter((c) => {
                switch (c.command || '') {
                    case blockchain_1.Blockchain.COMMAND_ADD_PEER:
                    case blockchain_1.Blockchain.COMMAND_REMOVE_PEER:
                    case blockchain_1.Blockchain.COMMAND_MODIFY_STAKE:
                    case blockchain_1.Blockchain.COMMAND_DATA:
                    case blockchain_1.Blockchain.COMMAND_DECISION:
                        return true;
                    default:
                        return false;
                }
            }).length === tx.commands.length);
    }
}
exports.Validation = Validation;
