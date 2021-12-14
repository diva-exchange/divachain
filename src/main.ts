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
import { Genesis } from './genesis';
import fs from 'fs';
import path from 'path';

class Main {
  private config: Config = {} as Config;

  static async make(c: Configuration) {
    const self = new Main();
    self.config = await Config.make(c);
    await self.start();
  }

  private async start() {
    const server = new Server(this.config);
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

if (process.env.GENESIS === '1') {
  (async () => {
    const obj = await Genesis.create();
    const _p = process.env.GENESIS_PATH || '';
    if (_p && fs.existsSync(path.dirname(_p)) && /\.json$/.test(_p)) {
      fs.writeFileSync(_p, JSON.stringify(obj.genesis));
    } else {
      process.stdout.write(JSON.stringify(obj.genesis));
    }
  })();
} else {
  //@TODO load configuration?
  const c: Configuration = {} as Configuration;
  (async () => {
    await Main.make(c);
  })();
}
