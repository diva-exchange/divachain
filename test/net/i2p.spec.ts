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

import { suite, test, timeout } from '@testdeck/mocha';
import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';

import { Genesis } from '../genesis';
import { Server } from '../../src/net/server';
import { Config } from '../../src/config';

chai.use(chaiHttp);

@suite
class TestServerI2P {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  static async before(): Promise<void> {
    process.env.SIZE_TESTNET = process.env.SIZE_TESTNET || '9';
    process.env.NETWORK_SIZE = process.env.NETWORK_SIZE || '7';
    process.env.BASE_PORT = process.env.BASE_PORT || '17000';
    process.env.BASE_PORT_FEED = process.env.BASE_PORT_FEED || '18000';
    process.env.IP = process.env.IP || '127.27.27.1';
    process.env.HAS_I2P = '1';
    process.env.DEBUG_PERFORMANCE = '1';

    TestServerI2P.mapConfigServer = await Genesis.create();

    for (const pk of TestServerI2P.mapConfigServer.keys()) {
      await TestServerI2P.createServer(pk);
    }
    return Promise.resolve();
  }

  static async after(): Promise<void> {
    return new Promise((resolve) => {
      for (const s of TestServerI2P.mapServer.values()) {
        s.shutdown();
      }
      // give the servers some time to shudown
      setTimeout(resolve, 1000);
    });
  }

  static async createServer(publicKey: string) {
    const s = new Server(TestServerI2P.mapConfigServer.get(publicKey) || {} as Config);
    await s.start();
    TestServerI2P.mapServer.set(publicKey, s);
    return s;
  }

  @test
  async default404() {
    const config = [...TestServerI2P.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }
}
