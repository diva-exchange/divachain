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
 * Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
 */

import { suite, test, timeout } from '@testdeck/mocha';
import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';

import { Genesis } from '../../src/genesis';
import { Server } from '../../src/net/server';
import { Config, DEFAULT_NAME_GENESIS_BLOCK } from '../../src/config';
import crypto from 'crypto';
import { Logger } from '../../src/logger';
import fs from 'fs';
import path from 'path';

chai.use(chaiHttp);

@suite(timeout(300000))
class TestServerI2P {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  static async before(): Promise<void> {
    process.env.SIZE_NETWORK = process.env.SIZE_NETWORK || '9';
    process.env.IP = process.env.IP || '0.0.0.0';
    process.env.BASE_PORT = process.env.BASE_PORT || '17000';
    process.env.BASE_PORT_FEED = process.env.BASE_PORT_FEED || '18000';
    process.env.I2P_SOCKS_HOST = '172.19.75.11';
    process.env.I2P_SAM_HTTP_HOST = '172.19.75.11';
    process.env.I2P_SAM_UDP_HOST = '172.19.75.12';
    process.env.I2P_SAM_FORWARD_HTTP_HOST = process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1';
    process.env.I2P_SAM_FORWARD_HTTP_PORT = process.env.I2P_SAM_FORWARD_HTTP_PORT || process.env.BASE_PORT;
    process.env.I2P_SAM_FORWARD_UDP_HOST = process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1';
    process.env.I2P_SAM_LISTEN_UDP_HOST = process.env.I2P_SAM_LISTEN_UDP_HOST || '0.0.0.0';
    process.env.DEBUG_PERFORMANCE = '1';

    const pathGenesis = path.join(__dirname, '/../genesis', DEFAULT_NAME_GENESIS_BLOCK) + '.json';
    if (!fs.existsSync(pathGenesis) || !fs.existsSync(pathGenesis + '.config')) {
      const obj = await Genesis.create(path.join(__dirname, '/../'));
      fs.writeFileSync(pathGenesis, JSON.stringify(obj.genesis));
      fs.writeFileSync(pathGenesis + '.config', JSON.stringify(obj.config), { mode: '0600' });
    } else {
      fs.rmdirSync(__dirname + '/../blockstore', { recursive: true });
      fs.rmdirSync(__dirname + '/../state', { recursive: true });
      fs.mkdirSync(__dirname + '/../blockstore');
      fs.mkdirSync(__dirname + '/../state');
      fs.copyFileSync(__dirname + '/../../blockstore/.gitignore', __dirname + '/../blockstore/.gitignore');
      fs.copyFileSync(__dirname + '/../../state/.gitignore', __dirname + '/../state/.gitignore');
    }

    TestServerI2P.mapConfigServer = new Map(JSON.parse(fs.readFileSync(pathGenesis + '.config').toString()));

    for (const pk of TestServerI2P.mapConfigServer.keys()) {
      const c = TestServerI2P.mapConfigServer.get(pk) || ({} as Config);
      c.path_app = path.join(__dirname, '/../');
      c.path_genesis = pathGenesis;
      c.path_keys = path.join(__dirname, '/../keys/');
      c.path_blockstore = path.join(__dirname, '/../blockstore/');
      c.path_state = path.join(__dirname, '/../state/');

      TestServerI2P.mapConfigServer.set(pk, c);
      await TestServerI2P.createServer(pk);
    }

    // wait for the servers to get ready
    return new Promise((resolve) => {
      const i = setInterval(async () => {
        if (TestServerI2P.mapConfigServer.size === TestServerI2P.mapServer.size) {
          clearInterval(i);
          // wait for 20 seconds
          Logger.trace('Test servers available, waiting 20s to let them integrate...');
          await TestServerI2P.wait(20000);
          resolve();
        }
      }, 1000);
    });
  }

  static async after(): Promise<void> {
    for (const s of TestServerI2P.mapServer.values()) {
      await s.shutdown();
    }
  }

  static async createServer(publicKey: string) {
    const s = new Server(TestServerI2P.mapConfigServer.get(publicKey) || ({} as Config));
    s.start().then(() => {
      TestServerI2P.mapServer.set(publicKey, s);
    });
    return s;
  }

  @test
  async default404() {
    const config = [...TestServerI2P.mapConfigServer.values()][0];
    const res = await chai.request(`http://localhost:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  @timeout(90000)
  async singleTransaction() {
    const i = Math.floor(Math.random() * TestServerI2P.mapConfigServer.size);
    const origin = [...TestServerI2P.mapConfigServer.keys()][i];
    const config = [...TestServerI2P.mapConfigServer.values()][i];
    const baseUrl = `http://localhost:${config.port}`;

    Logger.trace(`Sending singleTx to http://localhost:${config.port}`);
    let res = await chai
      .request(baseUrl)
      .put('/transaction/singleTx')
      .send([{ seq: 1, command: 'data', ns: 'test:data:singleTx', d: '1-singleTx' }]);
    expect(res).to.have.status(200);
    expect(res.body.ident).to.be.eq('singleTx');

    Logger.trace('waiting for sync (20s)...');
    await TestServerI2P.wait(20000);

    res = await chai.request(baseUrl).get(`/transaction/${origin}/singleTx`);
    expect(res.status).eq(200);
  }

  @test
  @timeout(300000)
  async multiTransaction() {
    let baseUrl, res;
    const arrayOrigin: Array<string> = [];

    const nTx = 60;

    for (let x = 0; x < nTx; x++) {
      const i = Math.floor(Math.random() * TestServerI2P.mapConfigServer.size);
      const config = [...TestServerI2P.mapConfigServer.values()][i];
      arrayOrigin.push([...TestServerI2P.mapConfigServer.keys()][i]);
      baseUrl = `http://localhost:${config.port}`;

      Logger.trace(`Sending multiTx${x} to http://localhost:${config.port}`);

      res = await chai
        .request(baseUrl)
        .put('/transaction/multiTx' + x)
        .send([{ seq: 1, command: 'data', ns: 'test:data:multiTx', d: `multiTx${x}` }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq(`multiTx${x}`);
      await TestServerI2P.wait(Math.ceil(Math.random() * 100));
    }

    Logger.trace('waiting for sync (90s)...');
    await TestServerI2P.wait(90000);

    for (let x = 0; x < nTx; x++) {
      res = await chai.request(baseUrl).get(`/transaction/${arrayOrigin[x]}/multiTx${x}`);
      expect(res.status).eq(200);
    }
  }

  @test
  @timeout(300000)
  async transactionTestLoad() {
    const l = [...TestServerI2P.mapConfigServer.values()].length;

    // some data tx's
    for (let t = l - 1; t > l / 2; t--) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://localhost:${config.port}`);
      const res = await chai
        .request(`http://localhost:${config.port}`)
        .put('/transaction/data' + t)
        .send([{ seq: 1, command: 'data', ns: 'test:data', d: '1-abcABC' + t }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t);
    }

    // decision tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending decision tx [h=6] to http://localhost:${config.port}`);
      const res = await chai
        .request(`http://localhost:${config.port}`)
        .put('/transaction/decision' + t)
        .send([{ seq: 1, command: 'decision', ns: 'test:dec', h: 6, d: 'SomeDecisionData' }]);
      Logger.trace(`${res.status} - ${res.body.ident}`);
      await TestServerI2P.wait(750);
    }

    // more data tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://localhost:${config.port}`);
      const res = await chai
        .request(`http://localhost:${config.port}`)
        .put('/transaction/data' + t * 10)
        .send([{ seq: 1, command: 'data', ns: 'test:data', d: 'tested-content' }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t * 10);
      await TestServerI2P.wait(50);
    }

    // even more data tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://localhost:${config.port}`);
      const res = await chai
        .request(`http://localhost:${config.port}`)
        .put('/transaction/data' + t * 100)
        .send([{ seq: 1, command: 'data', ns: 'test:more-data', d: 'more-content' }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t * 100);
      await TestServerI2P.wait(Math.ceil(Math.random() * 5000));
    }

    // new decision tx's - must fail, since the decision has been taken (height=6)
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending decision tx [h=30] to http://localhost:${config.port}`);
      await chai
        .request(`http://localhost:${config.port}`)
        .put('/transaction/decision' + t * 100)
        .send([{ seq: 1, command: 'decision', ns: 'test:dec', h: 30, d: 'TestedNewDecisionData' }]);
      await TestServerI2P.wait(Math.ceil(Math.random() * 200));
    }

    Logger.trace('waiting for sync (30s)...');
    // wait for sync
    await TestServerI2P.wait(30000);

    // test for data state
    const config = [...TestServerI2P.mapConfigServer.values()][3];
    const resState = await chai.request(`http://localhost:${config.port}`).get('/state/test:dec');
    expect(resState).to.have.status(200);
    expect(JSON.parse(resState.body.value).h).to.be.eq(6);
  }

  @test
  @timeout(6000000)
  async stressMultiTransaction() {
    const _outer = Number(process.env.TRANSACTIONS) > 5 ? Number(process.env.TRANSACTIONS) : 250;
    const _inner = 6; // commands

    // create blocks containing multiple transactions
    let seq = 1;
    const arrayConfig = [...TestServerI2P.mapConfigServer.values()];
    const arrayOrigin = [...TestServerI2P.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];
    const arrayIdents: Array<string> = [];
    const arrayTimestamp: Array<number> = [];

    for (let _i = 0; _i < _outer; _i++) {
      const aT: Array<any> = [];
      if (_i % 2 === 0) {
        for (let _j = 0; _j < _inner; _j++) {
          aT.push({ seq: seq++, command: 'data', ns: 'test:test', d: Date.now().toString() });
        }
      } else {
        const heightDecision = Math.floor(_i / 10) + 20;
        aT.push({ seq: seq++, command: 'decision', ns: 'test:test', h: heightDecision, d: 'dec' });
        aT.push({ seq: seq++, command: 'decision', ns: 'test:test:' + heightDecision, h: heightDecision, d: 'dec' });
      }

      const i = crypto.randomInt(0, arrayConfig.length);
      try {
        const res = await chai
          .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
          .put('/transaction')
          .send(aT);
        if (res.status === 200) {
          arrayTimestamp.push(new Date().getTime());
          arrayRequests.push(arrayOrigin[i]);
          arrayIdents.push(res.body.ident);
          console.debug(
            `${_i} http://${arrayConfig[i].ip}:${arrayConfig[i].port}/transaction/${arrayOrigin[i]}/${res.body.ident}`
          );
        }
      } catch (error) {
        console.error(error);
      }
      await TestServerI2P.wait(Math.ceil(Math.random() * 5000));
    }

    console.debug('waiting 120s to sync');
    // wait for a possible sync
    await TestServerI2P.wait(120000);

    // all blockchains have to be equal
    const arrayBlocks: Array<any> = [];
    for (const config of arrayConfig) {
      const res = await chai.request(`http://localhost:${config.port}`).get('/block/latest');
      arrayBlocks.push(res.body);
    }
    const _h = arrayBlocks[0].hash;
    console.log('Equality check');
    arrayBlocks.forEach((_b, i) => {
      console.log(`${i}: ${_b.hash} (${_b.height})`);
      expect(_h).eq(_b.hash);
    });

    let x = 0;
    while (arrayRequests.length) {
      const origin = arrayRequests.shift();
      const ident = arrayIdents.shift();
      const i = crypto.randomInt(0, arrayConfig.length);
      const baseUrl = `http://${arrayConfig[i].ip}:${arrayConfig[i].port}`;
      const res = await chai.request(baseUrl).get(`/transaction/${origin}/${ident}`);
      if (res.status === 200) {
        const perf = await chai.request(baseUrl).get(`/debug/performance/${res.body.height}`);
        const ts = arrayTimestamp.shift() || 0;
        console.log(
          perf.body.timestamp
            ? `${x}: ${perf.body.timestamp - ts}  ms`
            : `No performance data for block ${res.body.height}`
        );
      } else {
        console.error(`Request ${x} not found: ${baseUrl}/transaction/${origin}/${ident}`);
      }
      x++;
    }
  }

  private static async wait(s: number) {
    // wait a bit
    await new Promise((resolve) => {
      setTimeout(resolve, s, true);
    });
  }
}
