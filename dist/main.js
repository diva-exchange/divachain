"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./net/server");
const config_1 = require("./config");
class Main {
    constructor() {
        this.config = {};
    }
    static async make(c) {
        const self = new Main();
        self.config = await config_1.Config.make(c);
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
        await server.start();
    }
}
const c = {};
(async () => {
    await Main.make(c);
})();
