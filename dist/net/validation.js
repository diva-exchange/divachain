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
const config_1 = require("../config");
class Validation {
    constructor(server) {
        this.server = server;
        const pathSchema = path_1.default.join(__dirname, '../schema/');
        const schemaMessage = require(pathSchema + 'message/message.json');
        const schemaAddTx = require(pathSchema + 'message/add-tx.json');
        const schemaProposeBlock = require(pathSchema + 'message/propose-block.json');
        const schemaSignBlock = require(pathSchema + 'message/sign-block.json');
        const schemaConfirmBlock = require(pathSchema + 'message/confirm-block.json');
        const schemaStatus = require(pathSchema + 'message/status.json');
        const schemaBlockv7 = require(pathSchema + 'block/v7/block.json');
        const schemaTxv7 = require(pathSchema + 'block/v7/transaction/tx.json');
        const schemaVotev7 = require(pathSchema + 'block/v7/vote.json');
        const schemaAddPeerv7 = require(pathSchema + 'block/v7/transaction/add-peer.json');
        const schemaRemovePeerv7 = require(pathSchema +
            'block/v7/transaction/remove-peer.json');
        const schemaModifyStakev7 = require(pathSchema +
            'block/v7/transaction/modify-stake.json');
        const schemaDatav7 = require(pathSchema + 'block/v7/transaction/data.json');
        const schemaDecisionv7 = require(pathSchema + 'block/v7/transaction/decision.json');
        this.message = new ajv_1.default({
            schemas: [
                schemaAddTx,
                schemaProposeBlock,
                schemaSignBlock,
                schemaConfirmBlock,
                schemaStatus,
                schemaBlockv7,
                schemaTxv7,
                schemaVotev7,
                schemaAddPeerv7,
                schemaRemovePeerv7,
                schemaModifyStakev7,
                schemaDatav7,
                schemaDecisionv7,
            ],
        }).compile(schemaMessage);
        this.tx = new ajv_1.default({
            schemas: [schemaAddPeerv7, schemaRemovePeerv7, schemaModifyStakev7, schemaDatav7, schemaDecisionv7],
        }).compile(schemaTxv7);
    }
    static make(server) {
        return new Validation(server);
    }
    validateMessage(m) {
        switch (m.type()) {
            case message_1.Message.TYPE_ADD_TX:
            case message_1.Message.TYPE_PROPOSE_BLOCK:
            case message_1.Message.TYPE_SIGN_BLOCK:
            case message_1.Message.TYPE_CONFIRM_BLOCK:
            case message_1.Message.TYPE_STATUS:
                if (!this.message(m.getMessage())) {
                    logger_1.Logger.trace('Validation.validateMessage() failed');
                    logger_1.Logger.trace(`${JSON.stringify(this.message.errors)}`);
                    return false;
                }
                return true;
            default:
                logger_1.Logger.trace('Unknown message type');
                return false;
        }
    }
    validateBlock(structBlock, doVoteValidation = true) {
        const { version, previousHash, hash, height, tx, votes } = structBlock;
        if (!tx.length) {
            logger_1.Logger.trace(`Validation.validateBlock() - empty tx, block #${height}`);
            return false;
        }
        if (util_1.Util.hash([version, previousHash, JSON.stringify(tx), height].join()) !== hash) {
            logger_1.Logger.trace(`Validation.validateBlock() - invalid hash, block #${height}`);
            return false;
        }
        let _aOrigin = [];
        if (doVoteValidation) {
            if (votes.length < this.server.getBlockchain().getQuorum()) {
                logger_1.Logger.trace(`Validation.validateBlock() - not enough votes, block #${height}`);
                return false;
            }
            for (const vote of votes) {
                if (_aOrigin.includes(vote.origin)) {
                    logger_1.Logger.trace(`Validation.validateBlock() - Multiple votes from same origin, block #${height}`);
                    return false;
                }
                _aOrigin.push(vote.origin);
                if (!util_1.Util.verifySignature(vote.origin, vote.sig, hash)) {
                    logger_1.Logger.trace(`Validation.validateBlock() - invalid vote, block #${height}, origin ${vote.origin}`);
                    return false;
                }
            }
        }
        _aOrigin = [];
        for (const transaction of tx) {
            if (_aOrigin.includes(transaction.origin)) {
                logger_1.Logger.trace(`Validation.validateBlock() - Multiple transactions from same origin, block #${height}`);
                return false;
            }
            _aOrigin.push(transaction.origin);
            if (!this.validateTx(height, transaction)) {
                logger_1.Logger.trace(`Validation.validateBlock() - invalid tx, block #${height}, tx #${transaction.ident}`);
                return false;
            }
        }
        return true;
    }
    validateTx(height, tx) {
        return (this.tx(tx) &&
            height > 0 &&
            Array.isArray(tx.commands) &&
            util_1.Util.verifySignature(tx.origin, tx.sig, height + JSON.stringify(tx.commands)) &&
            tx.commands.filter((c) => {
                switch (c.command || '') {
                    case blockchain_1.Blockchain.COMMAND_ADD_PEER:
                        return this.server.getBlockchain().getMapPeer().size < config_1.MAX_NETWORK_SIZE;
                    case blockchain_1.Blockchain.COMMAND_REMOVE_PEER:
                    case blockchain_1.Blockchain.COMMAND_MODIFY_STAKE:
                    case blockchain_1.Blockchain.COMMAND_DATA:
                        return true;
                    case blockchain_1.Blockchain.COMMAND_DECISION:
                        return (c.h >= height && !this.server.getBlockchain().isDecisionTaken(c));
                    default:
                        return false;
                }
            }).length === tx.commands.length);
    }
}
exports.Validation = Validation;
