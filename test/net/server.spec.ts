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
import path from 'path';

import { Server } from '../../src/net/server';
import { Config, Configuration } from '../../src/config';
import { BlockStruct } from '../../src/chain/block';
import { Blockchain } from '../../src/chain/blockchain';
import { CommandAddPeer, TransactionStruct } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import * as fs from 'fs';
import { Logger } from '../../src/logger';

chai.use(chaiHttp);

const SIZE_TESTNET = 7;
const BASE_PORT = 17000;
const IP_P2P = '127.27.27.2';
const IP_HTTP = '127.27.27.1';

@suite
class TestServer {
  static mapConfigServer: Map<string, Configuration> = new Map();
  static mapServer: Map<string, Server> = new Map();

  @timeout(20000)
  static before(): Promise<void> {
    Logger.trace('TestServer.before()');

    // create a genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../genesis.json'));

    const tx: TransactionStruct = {
      ident: 'genesis',
      origin: '1234567890123456789012345678901234567890123',
      timestamp: 88355100000,
      commands: [],
      sig: '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
    };
    const cmds: Array<CommandAddPeer> = [];
    for (let i = 1; i <= SIZE_TESTNET; i++) {
      const config = new Config({
        p2p_ip: IP_P2P,
        p2p_port: BASE_PORT + i,
        http_ip: IP_HTTP,
        http_port: BASE_PORT + i,
        path_state: path.join(__dirname, '../state'),
        path_blockstore: path.join(__dirname, '../blockstore'),
        path_genesis: path.join(__dirname, '../genesis.json'),
      });

      const publicKey = new Wallet(config).getPublicKey();
      this.mapConfigServer.set(publicKey, config);

      cmds.push({
        seq: i,
        command: 'addPeer',
        host: IP_P2P,
        port: BASE_PORT + i,
        publicKey: publicKey,
      });
    }
    tx.commands = cmds;
    genesis.tx = [tx];
    fs.writeFileSync(path.join(__dirname, '../test-genesis.json'), JSON.stringify(genesis));

    return new Promise((resolve) => {
      setTimeout(resolve, 19000);

      for (const pk of TestServer.mapConfigServer.keys()) {
        (async () => {
          await TestServer.createServer(pk);
        })();
      }
    });
  }

  @timeout(60000)
  static after(): Promise<void> {
    return new Promise((resolve) => {
      let c = TestServer.mapServer.size;
      TestServer.mapServer.forEach(async (s, publicKey) => {
        await s.shutdown();

        const config = TestServer.mapConfigServer.get(publicKey) || ({} as Config);
        const ident = (config.p2p_ip + '_' + config.p2p_port).replace(/[^0-9_]/g, '-');
        config.path_state && fs.unlinkSync(path.join(config.path_state, `${ident}.seed`));
        fs.rmdirSync(path.join(__dirname, '../blockstore/', publicKey), { recursive: true });
        fs.rmdirSync(path.join(__dirname, '../state/', publicKey), { recursive: true });
        c--;
        if (!c) {
          setTimeout(resolve, 500);
        }
      });
      Logger.trace('TestServer.after()');
    });
  }

  static async createServer(publicKey: string) {
    const s = new Server(
      new Config({
        ...TestServer.mapConfigServer.get(publicKey),
        ...{
          path_genesis: path.join(__dirname, '../test-genesis.json'),
          path_blockstore: path.join(__dirname, '../blockstore'),
          path_state: path.join(__dirname, '../state'),
        },
      })
    );
    await s.listen();
    TestServer.mapServer.set(publicKey, s);
    return s;
  }

  @test
  async default404() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  async peers() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/peers');
    expect(res).to.have.status(200);
  }

  @test
  async statePeers() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/state/peers');
    expect(res).to.have.status(200);
  }

  @test
  async network() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/network');
    expect(res).to.have.status(200);
  }

  @test
  async health() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/health');
    expect(res).to.have.status(200);
  }

  @test
  async gossip() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/gossip');
    expect(res).to.have.status(200);
  }

  @test
  async stackTransactions() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/stack/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolTransactions() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/pool/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolVotes() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/pool/votes');
    expect(res).to.have.status(200);
  }

  @test
  async poolCommits() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/pool/commits');
    expect(res).to.have.status(200);
  }

  @test
  async poolBlocks() {
    const res = await chai.request(`http://${IP_HTTP}:17001`).get('/pool/blocks');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    let res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?limit=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?gte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?gte=-1&lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?gte=1&lte=-1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks?gte=1&lte=2');
    expect(res).to.have.status(200);
  }

  @test
  async page() {
    let res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks/page/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${IP_HTTP}:17001`).get('/blocks/page/1?size=1');
    expect(res).to.have.status(200);
  }

  @test
  @slow(4000)
  @timeout(4000)
  stressMultiTransaction(done: Function) {
    const _outer = 4;
    const _inner = 4;

    // create blocks containing multiple transactions
    let seq = 1;
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    const arrayOrigin = [...TestServer.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];
    for (let _i = 0; _i < _outer; _i++) {
      setTimeout(async () => {
        const aT = [];
        for (let _j = 0; _j < _inner; _j++) {
          aT.push({ seq: seq++, command: 'testLoad', timestamp: Date.now() });
        }
        const i = Math.floor(Math.random() * (arrayConfig.length - 1));
        arrayRequests.push(arrayOrigin[i]);
        await chai
          .request(`http://${arrayConfig[i].http_ip}:${arrayConfig[i].http_port}`)
          .put(`/transaction/seq${_i}`)
          .send(aT);
      }, 1000 + _i * 50);
    }

    setTimeout(async () => {
      arrayRequests.forEach(async (origin, i) => {
        const res = await chai.request(`http://${IP_HTTP}:17001`).get(`/transaction/${origin}/seq${i}`);
        expect(res).to.have.status(200);
        expect(res.body.ident).eq(`seq${i}`);
        expect(res.body.command.length).eq(_inner);
      });

      done();
    }, 3000);
  }
}
