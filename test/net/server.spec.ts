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

import { suite, test, slow, timeout } from '@testdeck/mocha';
import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';

import { Server } from '../../src/net/server';
import { Config } from '../../src/config';
import { Genesis } from '../genesis';

chai.use(chaiHttp);

@suite(timeout(60000))
class TestServer {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  static async before(): Promise<void> {
    process.env.I2P_SOCKS_HOST = '';
    process.env.I2P_SAM_HOST = '';
    process.env.SIZE_TESTNET = process.env.SIZE_TESTNET || '9';
    process.env.NETWORK_SIZE = process.env.NETWORK_SIZE || '7';
    process.env.BASE_PORT = process.env.BASE_PORT || '17000';
    process.env.BASE_PORT_FEED = process.env.BASE_PORT_FEED || '18000';
    process.env.IP = process.env.IP || '127.27.27.1';
    process.env.HAS_I2P = '0';
    process.env.DEBUG_PERFORMANCE = '1';

    TestServer.mapConfigServer = await Genesis.create();

    for (const pk of TestServer.mapConfigServer.keys()) {
      await TestServer.createServer(pk);
    }

    // wait for the servers to get ready
    return new Promise((resolve) => {
      const i = setInterval(() => {
        if (TestServer.mapConfigServer.size === TestServer.mapServer.size) {
          clearInterval(i);
          resolve();
        }
      }, 250);
    });
  }

  static async after(): Promise<void> {
    for (const s of TestServer.mapServer.values()) {
      await s.shutdown();
    }
  }

  static async createServer(publicKey: string) {
    const s = new Server(TestServer.mapConfigServer.get(publicKey) || ({} as Config));
    s.start().then(() => {
      TestServer.mapServer.set(publicKey, s);
    });
    return s;
  }

  @test
  async default404() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  @slow(120000)
  @timeout(120000)
  async transactionTestLoad() {
    for (let t = 0; t < 3; t++) {
      const config = [...TestServer.mapConfigServer.values()][t];
      const res = await chai
        .request(`http://${config.ip}:${config.port}`)
        .put('/transaction/data' + t)
        .send([{ seq: 1, command: 'data', ns: 'test:test', base64url: 'abcABC' + t }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t);
      await TestServer.wait(50);
    }

    for (let t = 0; t < 3; t++) {
      const config = [...TestServer.mapConfigServer.values()][t];
      const res = await chai
        .request(`http://${config.ip}:${config.port}`)
        .put('/transaction/decision' + t)
        .send([{ seq: 1, command: 'decision', ns: 'test:test', base64url: 'abcABC' + t }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('decision' + t);
      await TestServer.wait(1000);
    }

    console.log('waiting for a possible sync...');
    // wait for a possible sync
    await TestServer.wait(30000);
  }

  @test
  @slow(399000)
  @timeout(400000)
  async transactionFails() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai
      .request(`http://${config.ip}:${config.port}`)
      .put('/transaction')
      .send([{ seq: 1, command: 'commandHasToFail' }]);
    expect(res).to.have.status(403);
  }

  @test
  async about() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/about');
    expect(res).to.have.status(200);
  }

  @test
  async peers() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/peers');
    expect(res).to.have.status(200);
  }

  @test
  async network() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/network');
    expect(res).to.have.status(200);
  }

  @test
  async state() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/state');
    expect(res).to.have.status(200);
    res = await chai.request(`http://${config.ip}:${config.port}`).get('/state/peer:invalid-key');
    expect(res).to.have.status(404);
    const _pk = [...TestServer.mapConfigServer.keys()][0];
    res = await chai.request(`http://${config.ip}:${config.port}`).get('/state/peer:' + _pk);
    expect(res).to.have.status(200);
    res = await chai.request(`http://${config.ip}:${config.port}`).get('/state/peer:' + _pk + '?filter=' + _pk);
    expect(res).to.have.status(200);
  }

  @test
  async stackTransactions() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/stack');
    expect(res).to.have.status(200);
  }

  @test
  async pool() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/locks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/votes');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/block');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?filter=addPeer');
    expect(res.body.length).gte(1);
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/genesis');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/latest');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/-1/1');
    expect(res).to.have.status(404);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/1/-1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/1/2');
    expect(res).to.have.status(200);
  }

  @test
  async page() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/page/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/page/1/20');
    expect(res).to.have.status(200);
  }

  @test
  async injectObjectAsTransaction() {
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    const res = await chai
      .request(`http://${arrayConfig[0].ip}:${arrayConfig[0].port}`)
      .put('/transaction')
      .send({ seq: 1, command: 'data-decision.json', ns: 'test', base64url: 'bogus' });

    expect(res).to.have.status(403);
  }

  @test
  @slow(10000000)
  @timeout(10000000)
  async stressMultiTransaction() {
    const _outer = Number(process.env.TRANSACTIONS) > 10 ? Number(process.env.TRANSACTIONS) : 100;
    const _inner = 4; // commands

    // create blocks containing multiple transactions
    let seq = 1;
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    const arrayOrigin = [...TestServer.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];
    const arrayIdents: Array<string> = [];
    const arrayTimestamp: Array<number> = [];

    for (let _i = 0; _i < _outer; _i++) {
      const aT: Array<any> = [];
      for (let _j = 0; _j < _inner; _j++) {
        aT.push({ seq: seq++, command: 'data', ns: 'test:test', base64url: Date.now().toString() });
      }
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));

      try {
        const res = await chai
          .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
          .put('/transaction')
          .send(aT);
        arrayTimestamp.push(new Date().getTime());
        arrayRequests.push(arrayOrigin[i]);
        arrayIdents.push(res.body.ident);
        console.debug(
          `${_i} http://${arrayConfig[i].ip}:${arrayConfig[i].port}/transaction/${arrayOrigin[i]}/${res.body.ident}`
        );
      } catch (error) {
        console.error(error);
      }
      await TestServer.wait(1 + Math.floor(Math.random() * 200));
    }

    console.debug('waiting for a possible sync');
    // wait for a possible sync
    await TestServer.wait(30000);

    // all blockchains have to be equal
    const arrayBlocks: Array<any> = [];
    for (const config of arrayConfig) {
      const res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/latest');
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
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));
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
