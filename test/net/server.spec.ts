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

chai.use(chaiHttp);

const ipP2P = '172.20.101.1';
const ipHTTP = '127.0.0.1';

@suite
class TestServer {
  static TEST_CONFIG_SERVER = [
    {
      secret: 'NODE1',
      p2p_ip: ipP2P,
      p2p_port: 17168,
      http_ip: ipHTTP,
      http_port: 17169,
    },
    {
      secret: 'NODE2',
      p2p_ip: ipP2P,
      p2p_port: 17268,
      http_ip: ipHTTP,
      http_port: 17269,
    },
    {
      secret: 'NODE3',
      p2p_ip: ipP2P,
      p2p_port: 17368,
      http_ip: ipHTTP,
      http_port: 17369,
    },
    {
      secret: 'NODE4',
      p2p_ip: ipP2P,
      p2p_port: 17468,
      http_ip: ipHTTP,
      http_port: 17469,
    },
    {
      secret: 'NODE5',
      p2p_ip: ipP2P,
      p2p_port: 17568,
      http_ip: ipHTTP,
      http_port: 17569,
    },
    {
      secret: 'NODE6',
      p2p_ip: ipP2P,
      p2p_port: 17668,
      http_ip: ipHTTP,
      http_port: 17669,
    },
    {
      secret: 'NODE7',
      p2p_ip: ipP2P,
      p2p_port: 17768,
      http_ip: ipHTTP,
      http_port: 17769,
    },
  ];

  static arrayServer: Array<Server> = [];

  @timeout(20000)
  static before(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 19000);

      for (let i = 0; i < TestServer.TEST_CONFIG_SERVER.length; i++) {
        (async () => await TestServer.createServer(i))();
      }
    });
  }

  @timeout(60000)
  static after(): Promise<void> {
    return new Promise((resolve) => {
      let c = TestServer.arrayServer.length;
      TestServer.arrayServer.forEach(async (s) => {
        await s.shutdown();
        c--;
        if (!c) {
          setTimeout(resolve, 500);
        }
      });
    });
  }

  static async createServer(i: number = 0) {
    const s = new Server(TestServer.TEST_CONFIG_SERVER[i]);
    await s.listen();
    TestServer.arrayServer.push(s);
    return s;
  }

  @test
  isAvailable() {
    expect(TestServer.arrayServer.length).eq(TestServer.TEST_CONFIG_SERVER.length);
  }

  @test
  async default404() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  async peers() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/peers');
    expect(res).to.have.status(200);
  }

  @test
  async statePeers() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/state/peers');
    expect(res).to.have.status(200);
  }

  @test
  async network() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/network');
    expect(res).to.have.status(200);
  }

  @test
  async health() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/health');
    expect(res).to.have.status(200);
  }

  @test
  async gossip() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/gossip');
    expect(res).to.have.status(200);
  }

  @test
  async stackTransactions() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/stack/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolTransactions() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/pool/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolVotes() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/pool/votes');
    expect(res).to.have.status(200);
  }

  @test
  async poolCommits() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/pool/commits');
    expect(res).to.have.status(200);
  }

  @test
  async poolBlocks() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/pool/blocks');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    let res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?limit=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?gte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?gte=-1&lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?gte=1&lte=-1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks?gte=1&lte=2');
    expect(res).to.have.status(200);
  }

  @test
  async page() {
    let res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks/page/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks/page/1?size=1');
    expect(res).to.have.status(200);
  }

  /*
  @test
  @slow(30000)
  @timeout(30000)
  stressMultiTransaction(done: Function) {
    const _outer = 16;
    const _inner = 4;

    const mapTransactions: Map<string, number> = new Map();

    // create blocks containing multiple transactions
    let seq = 1;
    for (let i = 0; i < _outer; i++) {
      setTimeout(async () => {
        const aT = [];
        for (let j = 0; j < _inner; j++) {
          aT.push({ seq: seq++, command: 'testLoad', timestamp: Date.now() });
        }
        const p = Math.floor(Math.random() * (TestServer.TEST_CONFIG_SERVER.length - 1)) + 1;
        const res = await chai.request(`http://${ipHTTP}:17${p}69`).put('/transaction').send(aT);

        const originIdent = Object.keys(TestServer.TEST_P2P_NETWORK)[p - 1] + '/' + res.body.ident;
        mapTransactions.set(originIdent, res.body.commands.length);
      }, 10000 + i * 50);
    }

    // test availability of transactions
    setTimeout(() => {
      let total = 0;
      for (const originIdent of mapTransactions.keys()) {
        const p = Math.floor(Math.random() * (TestServer.TEST_CONFIG_SERVER.length - 1)) + 1;
        const res = await chai.request(`http://${ipHTTP}:17${p}69`).get(`/transaction/${originIdent}`);
        total = total + (mapTransactions.get(originIdent) || 0);
        expect(res).to.have.status(200);
      }

      expect(total, 'Total Commmands').eq(_outer * _inner);
      expect(200, 'PUT transaction failed').eq(200);
      done();
    }, 25000);
  }
  */
}
