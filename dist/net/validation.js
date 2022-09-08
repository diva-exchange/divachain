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
        const schemaProposal = require(pathSchema + 'message/proposal.json');
        const schemaVote = require(pathSchema + 'message/vote.json');
        const schemaSync = require(pathSchema + 'message/sync.json');
        const schemaBlockV6 = require(pathSchema + 'block/v6/block.json');
        const schemaVotesV6 = require(pathSchema + 'block/v6/votes.json');
        const schemaTxV6 = require(pathSchema + 'block/v6/transaction/tx.json');
        const schemaAddPeerV6 = require(pathSchema + 'block/v6/transaction/add-peer.json');
        const schemaRemovePeerV6 = require(pathSchema +
            'block/v6/transaction/remove-peer.json');
        const schemaModifyStakeV6 = require(pathSchema +
            'block/v6/transaction/modify-stake.json');
        const schemaDataV6 = require(pathSchema + 'block/v6/transaction/data.json');
        const schemaDecisionV6 = require(pathSchema + 'block/v6/transaction/decision.json');
        this.message = new ajv_1.default({
            schemas: [
                schemaProposal,
                schemaVote,
                schemaSync,
                schemaBlockV6,
                schemaVotesV6,
                schemaTxV6,
                schemaAddPeerV6,
                schemaRemovePeerV6,
                schemaModifyStakeV6,
                schemaDataV6,
                schemaDecisionV6,
            ],
        }).compile(schemaMessage);
        this.tx = new ajv_1.default({
            schemas: [schemaAddPeerV6, schemaRemovePeerV6, schemaModifyStakeV6, schemaDataV6, schemaDecisionV6],
        }).compile(schemaTxV6);
    }
    static make(server) {
        return new Validation(server);
    }
    validateMessage(m) {
        switch (m.type()) {
            case message_1.Message.TYPE_PROPOSAL:
            case message_1.Message.TYPE_VOTE:
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
        if (!tx.length || !votes.length) {
            logger_1.Logger.trace(`Validation.validateBlock() - empty tx or votes: ${height}`);
            return false;
        }
        _aOrigin = [];
        const voteHash = [height, util_1.Util.hash(JSON.stringify(tx))].join();
        for (const vote of votes) {
            if (_aOrigin.includes(vote.origin)) {
                logger_1.Logger.trace(`Validation.validateBlock() - Multiple votes from same origin: ${height}`);
                return false;
            }
            _aOrigin.push(vote.origin);
            if (!util_1.Util.verifySignature(vote.origin, vote.sig, voteHash)) {
                logger_1.Logger.trace(`Validation.validateBlock() - invalid vote: ${height}`);
                return false;
            }
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
