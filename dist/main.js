"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./net/server");
const config_1 = require("./config");
const logger_1 = require("./logger");
class Main {
    constructor() {
        this.config = {};
    }
    static async make() {
        const self = new Main();
        self.config = await config_1.Config.make({});
        await self.start();
    }
    async start() {
        const server = new server_1.Server(this.config);
        process.once('SIGINT', async () => {
            await server.shutdown();
            process.exit(0);
        });
        process.once('SIGTERM', async () => {
            await server.shutdown();
            process.exit(0);
        });
        process.on('uncaughtException', async (err) => {
            logger_1.Logger.fatal(err, 'uncaughtException');
            if (process.env.NODE_ENV !== 'test') {
                await server.shutdown();
                process.exit(1);
            }
        });
        process.on('unhandledRejection', async (err) => {
            logger_1.Logger.fatal(err, 'unhandledRejection');
            if (process.env.NODE_ENV !== 'test') {
                await server.shutdown();
                process.exit(1);
            }
        });
        await server.start();
    }
}
(async () => {
    await Main.make();
})();
