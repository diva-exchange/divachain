"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const pino_1 = __importDefault(require("pino"));
exports.Logger = (0, pino_1.default)(process.env.NODE_ENV === 'development'
    ? { level: process.env.LOG_LEVEL || 'trace' }
    : { level: process.env.LOG_LEVEL || 'warn' });
process.on('uncaughtException', (err) => {
    exports.Logger.fatal(err, 'uncaughtException');
    process.env.NODE_ENV !== 'test' && process.exit(1);
});
process.on('unhandledRejection', (err) => {
    exports.Logger.fatal(err, 'unhandledRejection');
    process.env.NODE_ENV !== 'test' && process.exit(1);
});
