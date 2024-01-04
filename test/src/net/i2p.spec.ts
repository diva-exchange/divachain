/**
 * Copyright (C) 2021-2023 diva.exchange
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
import chaiHTTP from 'chai-http';
chai.use(chaiHTTP);

import { Genesis } from '../../../dist/genesis.js';
import { Server } from '../../../dist/net/server.js';
import { Config, DEFAULT_NAME_GENESIS } from '../../../dist/config.js';
import { TxStruct } from '../../../dist/chain/tx.js';
import { Logger } from '../../../dist/logger.js';
import { NAME_HEADER_TOKEN_API } from '../../../dist/chain/wallet.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

@suite(timeout(600000))
class TestServerI2P {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  static async before() {
    process.env.IS_TESTNET = '1';
    process.env.SIZE_NETWORK = process.env.SIZE_NETWORK || '9';
    process.env.IP = process.env.IP || '0.0.0.0';
    process.env.BASE_PORT = process.env.BASE_PORT || '17000';
    process.env.BASE_PORT_FEED = process.env.BASE_PORT_FEED || '18000';
    process.env.I2P_SOCKS_HOST = '172.19.75.11';

    process.env.I2P_SAM_HTTP_HOST = '172.19.75.11';
    process.env.I2P_SAM_FORWARD_HTTP_HOST = process.env.I2P_SAM_FORWARD_HTTP_HOST || '172.19.75.1';
    process.env.I2P_SAM_FORWARD_HTTP_PORT = process.env.I2P_SAM_FORWARD_HTTP_PORT || process.env.BASE_PORT;

    process.env.I2P_SAM_UDP_HOST = '172.19.75.12';
    process.env.I2P_SAM_FORWARD_UDP_HOST = process.env.I2P_SAM_FORWARD_UDP_HOST || '172.19.75.1';
    process.env.I2P_SAM_LISTEN_UDP_HOST = process.env.I2P_SAM_LISTEN_UDP_HOST || '0.0.0.0';

    process.env.DEBUG_PERFORMANCE = '0';

    // ___dirname points to /test/ folder
    const ___dirname: string = fs.realpathSync(path.dirname(import.meta.url.replace(/^file:\/\//, '')) + '/../../');
    const pathGenesis: string = path.join(___dirname, 'genesis', DEFAULT_NAME_GENESIS) + '.json';
    if (!fs.existsSync(pathGenesis) || !fs.existsSync(pathGenesis + '.config')) {
      const obj = await Genesis.create(___dirname);
      fs.writeFileSync(pathGenesis, JSON.stringify(obj.genesis));
      fs.writeFileSync(pathGenesis + '.config', JSON.stringify(obj.config), { mode: '0600' });
    } else {
      fs.rmSync(path.join(___dirname, 'db', 'chain'), { recursive: true, force: true });
      fs.rmSync(path.join(___dirname, 'db', 'state'), { recursive: true, force: true });
      fs.mkdirSync(path.join(___dirname, 'db', 'chain'));
      fs.mkdirSync(path.join(___dirname, 'db', 'state'));
    }

    // sorted by publicKey
    TestServerI2P.mapConfigServer = new Map(
      JSON.parse(fs.readFileSync(pathGenesis + '.config').toString()).sort((a: any, b: any): number =>
        a[0] > b[0] ? 1 : -1
      )
    );

    for (const pk of TestServerI2P.mapConfigServer.keys()) {
      const c: Config = TestServerI2P.mapConfigServer.get(pk) || ({} as Config);
      c.path_app = ___dirname;
      c.path_genesis = pathGenesis;
      c.path_keys = path.join(___dirname, 'keys/');
      c.path_chain = path.join(___dirname, 'db/chain/');
      c.path_state = path.join(___dirname, 'db/state/');

      TestServerI2P.mapConfigServer.set(pk, c);
      await TestServerI2P.createServer(pk);

      // random delay, 0s-5s, closer to reality
      await TestServerI2P.wait(Math.floor(Math.random() * 5000));
    }

    // wait for the servers to get ready
    return new Promise<void>((resolve) => {
      const i = setInterval(async () => {
        if (TestServerI2P.mapConfigServer.size * (2 / 3) < TestServerI2P.mapServer.size) {
          clearInterval(i);
          // wait for 60 seconds
          Logger.trace(
            `Test setup: ${TestServerI2P.mapServer.size} ready, out of ${process.env.SIZE_NETWORK} servers, waiting 60s to let them integrate...`
          );
          await TestServerI2P.wait(60000);
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

  static async createServer(publicKey: string): Promise<Server> {
    const s: Server = new Server(TestServerI2P.mapConfigServer.get(publicKey) || ({} as Config));
    s.start().then((): void => {
      TestServerI2P.mapServer.set(publicKey, s);
    });
    return s;
  }

  @test
  async default404(): Promise<void> {
    const config: Config = [...TestServerI2P.mapConfigServer.values()][0];
    const res = await chai.request(`http://127.0.0.1:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  @timeout(90000)
  async singleTransaction(): Promise<void> {
    let i: number;
    let origin: string;
    let config: Config;
    let baseUrl: string;
    let s: Server | undefined;

    do {
      i = Math.floor(Math.random() * TestServerI2P.mapConfigServer.size);
      origin = [...TestServerI2P.mapConfigServer.keys()][i];
      config = [...TestServerI2P.mapConfigServer.values()][i];
      baseUrl = `http://127.0.0.1:${config.port}`;
      s = TestServerI2P.mapServer.get(origin);
    } while (!s);

    Logger.trace(`Sending singleTx to http://127.0.0.1:${config.port}`);
    Logger.trace(`Using token: ${s.getWallet().getTokenAPI()}`);

    // 1K data
    const data: string = crypto.randomBytes(1024).toString('binary');
    let res = await chai
      .request(baseUrl)
      .put('/tx')
      .set(NAME_HEADER_TOKEN_API, s.getWallet().getTokenAPI())
      .send([{ command: 'data', ns: 'test:_data:singleTx', d: data }]);

    expect(res).to.have.status(200);

    Logger.trace('waiting for sync (40s)...');
    await TestServerI2P.wait(40000);

    res = await chai.request(baseUrl).get('/tx/latest');
    expect(res.status).eq(200);
  }

  @test
  @timeout(120000)
  async eachNodeTransaction(): Promise<void> {
    const origin: Array<string> = [...TestServerI2P.mapConfigServer.keys()];
    const config: Array<Config> = [...TestServerI2P.mapConfigServer.values()];

    const sent: Array<number> = [];
    for (let i = 0; i < origin.length; i++) {
      const s: Server | undefined = TestServerI2P.mapServer.get(origin[i]);
      if (!s) {
        Logger.trace(`Unavailable API for eachTx http://127.0.0.1:${config[i].port} - ${origin[i]}`);
        continue;
      }

      const baseUrl: string = `http://127.0.0.1:${config[i].port}`;
      Logger.trace(`Sending eachTx to http://127.0.0.1:${config[i].port} - ${origin[i]}`);
      Logger.trace(`Using token: ${s.getWallet().getTokenAPI()}`);

      // 1K data
      const data: string = crypto.randomBytes(1024).toString('binary');
      const res = await chai
        .request(baseUrl)
        .put('/tx')
        .set(NAME_HEADER_TOKEN_API, s.getWallet().getTokenAPI())
        .send([{ command: 'data', ns: 'test:_data:eachTx', d: data }]);
      await TestServerI2P.wait(Math.ceil(Math.random() * 1500));

      expect(res).to.have.status(200);
      sent.push(i);
    }

    Logger.trace('waiting for sync (90s)...');
    await TestServerI2P.wait(90000);
  }

  @test
  @timeout(100000000)
  async multiTransaction(): Promise<void> {
    let baseUrl, res;
    const origin: Array<string> = [...TestServerI2P.mapConfigServer.keys()];
    const config: Array<Config> = [...TestServerI2P.mapConfigServer.values()];
    const arrayTx: Array<string> = [];

    const nTx = 50;

    for (let x = 0; x < nTx; x++) {
      const i: number = Math.floor(Math.random() * config.length);
      const s: Server | undefined = TestServerI2P.mapServer.get(origin[i]);
      if (!s) {
        Logger.trace(`Unavailable API for eachTx http://127.0.0.1:${config[i].port} - ${origin[i]}`);
        continue;
      }

      baseUrl = `http://127.0.0.1:${config[i].port}`;
      Logger.trace(`Sending multiTx${x} to http://127.0.0.1:${config[i].port}`);

      const data: string = crypto.randomBytes(1024).toString('binary');
      res = await chai
        .request(baseUrl)
        .put('/tx')
        .set(NAME_HEADER_TOKEN_API, s.getWallet().getTokenAPI())
        .send([{ command: 'data', ns: 'test:_data:multiTx' + x, d: data }]);
      expect(res).to.have.status(200);
      await TestServerI2P.wait(Math.ceil(Math.random() * 2000));
      arrayTx[x] = origin[i];

      /*
      // shutdown one node in the middle of the process
      if (x === Math.floor(nTx / 1.5)) {
        const s = [...TestServerI2P.mapServer.values()][0];
        Logger.trace(`Shutting down server: ${s.config.port} ${s.getWallet().getPublicKey()}`);
        await s.shutdown();
        TestServerI2P.mapConfigServer.delete(s.getWallet().getPublicKey());
        TestServerI2P.mapServer.delete(s.getWallet().getPublicKey());
      }
*/
    }

    Logger.trace('waiting for sync (120secs)...');
    await TestServerI2P.wait(120 * 1000);

    Logger.trace('state of the network');
    for (const config of [...TestServerI2P.mapConfigServer.values()]) {
      try {
        res = await chai.request(`http://127.0.0.1:${config.port}`).get('/txs/2');
        Logger.trace(
          config.port + ': ' + (res.body as Array<TxStruct>).map((tx) => `${tx.height}/${tx.hash}`).join(';')
        );
      } catch (e) {
        Logger.trace(config.port + ': could not connect / ' + JSON.stringify(e));
      }
    }
  }

  @test
  @timeout(300000)
  async transactionTestLoad(): Promise<void> {
    const l = [...TestServerI2P.mapConfigServer.values()].length;

    // some _data tx's
    for (let t = l - 1; t > l / 2; t--) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://127.0.0.1:${config.port}`);
      const res = await chai
        .request(`http://127.0.0.1:${config.port}`)
        .put('/transaction/data' + t)
        .send([{ command: 'data', ns: 'test:_data', d: '1-abcABC' + t }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t);
    }

    // decision tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending decision tx [h=6] to http://127.0.0.1:${config.port}`);
      const res = await chai
        .request(`http://127.0.0.1:${config.port}`)
        .put('/transaction/decision' + t)
        .send([{ command: 'decision', ns: 'test:dec', h: 6, d: 'SomeDecisionData' }]);
      Logger.trace(`${res.status} - ${res.body.ident}`);
      await TestServerI2P.wait(750);
    }

    // more _data tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://127.0.0.1:${config.port}`);
      const res = await chai
        .request(`http://127.0.0.1:${config.port}`)
        .put('/transaction/data' + t * 10)
        .send([{ command: 'data', ns: 'test:_data', d: 'tested-content' }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t * 10);
      await TestServerI2P.wait(50);
    }

    // even more _data tx's
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending tx to http://127.0.0.1:${config.port}`);
      const res = await chai
        .request(`http://127.0.0.1:${config.port}`)
        .put('/transaction/data' + t * 100)
        .send([{ command: 'data', ns: 'test:more-_data', d: 'more-content' }]);
      expect(res).to.have.status(200);
      expect(res.body.ident).to.be.eq('data' + t * 100);
      await TestServerI2P.wait(Math.ceil(Math.random() * 5000));
    }

    // new decision tx's - must fail, since the decision has been taken (height=6)
    for (let t = 0; t < l; t++) {
      const config = [...TestServerI2P.mapConfigServer.values()][t];
      Logger.trace(`Sending decision tx [h=30] to http://127.0.0.1:${config.port}`);
      await chai
        .request(`http://127.0.0.1:${config.port}`)
        .put('/transaction/decision' + t * 100)
        .send([{ command: 'decision', ns: 'test:dec', h: 30, d: 'TestedNewDecisionData' }]);
      await TestServerI2P.wait(Math.ceil(Math.random() * 200));
    }

    Logger.trace('waiting for sync (30s)...');
    // wait for sync
    await TestServerI2P.wait(30000);

    // test for _data state
    const config = [...TestServerI2P.mapConfigServer.values()][3];
    const resState = await chai.request(`http://127.0.0.1:${config.port}`).get('/state/test:dec');
    expect(resState).to.have.status(200);
    expect(JSON.parse(resState.body.value).h).to.be.eq(6);
  }

  @test
  @timeout(600000000)
  async stressMultiTransaction(): Promise<void> {
    const _outer = Number(process.env.TRANSACTIONS) > 5 ? Number(process.env.TRANSACTIONS) : 100;
    const _inner = 6; // commands
    Logger.trace(`Testing ${_outer} transactions...`);

    // create blocks containing multiple transactions
    const arrayConfig = [...TestServerI2P.mapConfigServer.values()];
    const arrayOrigin = [...TestServerI2P.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];
    const arrayIdents: Array<string> = [];
    const arrayTimestamp: Array<number> = [];

    for (let _i = 1; _i <= _outer; _i++) {
      const aT: Array<any> = [];
      for (let _j = 0; _j < _inner; _j++) {
        aT.push({ command: 'data', ns: 'test:test', d: Date.now().toString() });
      }
      // if (_i % 2 === 0) {
      //   for (let _j = 0; _j < _inner; _j++) {
      //     aT.push({ command: '_data', ns: 'test:test', d: Date.now().toString() });
      //   }
      // } else {
      //   const heightDecision = Math.floor(_i / 10) + 20;
      //   aT.push({ command: 'decision', ns: 'test:test', h: heightDecision, d: 'dec' });
      //   aT.push({ command: 'decision', ns: 'test:test:' + heightDecision, h: heightDecision, d: 'dec' });
      // }

      const i = crypto.randomInt(0, arrayConfig.length);
      try {
        const s: Server = TestServerI2P.mapServer.get(arrayOrigin[i]) || ({} as Server);
        const res = await chai
          .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
          .put('/transaction')
          .set(NAME_HEADER_TOKEN_API, s.getWallet().getTokenAPI())
          .send(aT);
        if (res.status === 200) {
          arrayTimestamp.push(new Date().getTime());
          arrayRequests.push(arrayOrigin[i]);
          arrayIdents.push(res.body.ident);
          _i % Math.floor(_outer * 0.1) === 0 && Logger.trace(`${_i}/${_outer} ${arrayConfig[i].port}`);
        }
      } catch (error) {
        console.error(error);
      }
      await TestServerI2P.wait(Math.ceil(Math.random() * 500));

      // shutdown nodes in the middle of the process
      if (_i === Math.floor(_outer * 0.1) || _i === Math.floor(_outer * 0.25) || _i === Math.floor(_outer * 0.5)) {
        // if (_i === Math.floor(_outer * 0.2)) {
        const _del: number = crypto.randomInt(0, arrayConfig.length);
        const _pk: string = arrayOrigin.splice(_del, 1)[0];
        const _server: Server = TestServerI2P.mapServer.get(_pk) as Server;
        arrayConfig.splice(_del, 1);
        Logger.trace(`${_server.config.port} ${_pk}: SHUT DOWN`);
        await _server.shutdown();
        TestServerI2P.mapConfigServer.delete(_pk);
        TestServerI2P.mapServer.delete(_pk);
      }
    }

    console.debug('waiting 240s to sync');
    // wait for a possible sync
    await TestServerI2P.wait(240 * 1000);

    // all blockchains have to be equal
    const arrayBlocks: Array<any> = [];
    for (const config of arrayConfig) {
      const res = await chai.request(`http://127.0.0.1:${config.port}`).get('/block/latest');
      arrayBlocks.push(res.body);
    }
    const _h = arrayBlocks[0].hash;
    console.log('Equality check');
    arrayBlocks.forEach((_b, i) => {
      console.log(`${i}: ${_b.hash} (${_b.height})`);
      expect(_h).eq(_b.hash);
    });

    // let x = 0;
    // while (arrayRequests.length) {
    //   const origin = arrayRequests.shift();
    //   const ident = arrayIdents.shift();
    //   const i = crypto.randomInt(0, arrayConfig.length);
    //   const baseUrl = `http://${arrayConfig[i].ip}:${arrayConfig[i].port}`;
    //   const res = await chai.request(baseUrl).get(`/transaction/${origin}/${ident}`);
    //   if (res.status === 200) {
    //     const perf = await chai.request(baseUrl).get(`/debug/performance/${res.body.height}`);
    //     const ts = arrayTimestamp.shift() || 0;
    //     console.log(
    //       perf.body.timestamp
    //         ? `${x}: ${perf.body.timestamp - ts}  ms`
    //         : `No performance _data for block ${res.body.height}`
    //     );
    //   } else {
    //     console.error(`Request ${x} not found: ${baseUrl}/transaction/${origin}/${ident}`);
    //   }
    //   x++;
    // }
  }

  private static async wait(ms: number): Promise<void> {
    // wait some milliseconds
    await new Promise((resolve) => {
      setTimeout(resolve, ms, true);
    });
  }
}
