/**
 * Copyright (C) 2021 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { Server } from './net/server';
import { Config, Configuration } from './config';
import { Logger } from './logger';

class Main {
  private config: Config = {} as Config;

  static async make() {
    const self = new Main();
    self.config = await Config.make({} as Configuration);
    await self.start();
  }

  private async start() {
    const server = new Server(this.config);

    // termination handlers
    process.once('SIGINT', async () => {
      await server.shutdown();
      process.exit(0);
    });
    process.once('SIGTERM', async () => {
      await server.shutdown();
      process.exit(0);
    });

    // (unhandled) exception handlers
    process.on('uncaughtException', async (err) => {
      Logger.fatal(err, 'uncaughtException');
      if (process.env.NODE_ENV !== 'test') {
        await server.shutdown();
        process.exit(1);
      }
    });
    process.on('unhandledRejection', async (err) => {
      Logger.fatal(err, 'unhandledRejection');
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
