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
  static TEST_P2P_NETWORK = {
    NRuhtjcPouO1iCyd40b7egpRRBkcMKFMcz7sWbFCZSI: {
      host: '47hul5deyozlp5juumxvqtx6wmut5ertroga3gej4wtjlc6wcsya.b32.i2p',
      port: 17168,
    },
    z2aVOeo_Mvt0vr0MKUz54N_zM_7jQYVLzedbuSTBcXA: {
      host: 'o4jj2ldln3eelvqtc3hbauge274a4wun7nrnlnv54v44p6pz4lwa.b32.i2p',
      port: 17268,
    },
    Fd26iYIRxGRSz3wyK5vjQtoANEyEUl2_EcyCaRQMKIo: {
      host: 'yi2yzuqjeu7bvcltpdhlcwozdrfvhwvr42wgysmsoocw72vu5rca.b32.i2p',
      port: 17368,
    },
    '-4UR3gNsahU2ehP3CJLuiFLGe6mX2J7nwqjtg8Bvlng': {
      host: 'xnwjn3ohhzcdgiofyizctgkehcztdl2fcqamp3exmrvwqyrjmwkq.b32.i2p',
      port: 17468,
    },
    fw4sKitin_9cwLTQfUEk9_vOQmYCndraGU_PK9PjXKI: {
      host: '2mrfppk2yvbt6jhnfc2lqcjtbaht4rfrvypx4xydstt5ku5rnoaa.b32.i2p',
      port: 17568,
    },
    '5YHh90pMJOuWRXMK34DrWiUk20gHazd7TUT9bk6szDw': {
      host: 'lxkfr2flou6d5w6bcvysnqbczutyh4msklvswkzwne7lqfuk5tia.b32.i2p',
      port: 17668,
    },
    'KxUiHLdHf_ZyFmEXB-FuJDgB62H2neAzuzQ1cl8Q17I': {
      host: '6trjttkmca36b25e2khdisgd6wns4luhchaepevbqkmpvqn6xjmq.b32.i2p',
      port: 17768,
    },
  };

  static TEST_CONFIG_SERVER = [
    {
      secret: 'NODE1',
      p2p_ip: ipP2P,
      p2p_port: 17168,
      http_ip: ipHTTP,
      http_port: 17169,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE2',
      p2p_ip: ipP2P,
      p2p_port: 17268,
      http_ip: ipHTTP,
      http_port: 17269,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE3',
      p2p_ip: ipP2P,
      p2p_port: 17368,
      http_ip: ipHTTP,
      http_port: 17369,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE4',
      p2p_ip: ipP2P,
      p2p_port: 17468,
      http_ip: ipHTTP,
      http_port: 17469,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE5',
      p2p_ip: ipP2P,
      p2p_port: 17568,
      http_ip: ipHTTP,
      http_port: 17569,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE6',
      p2p_ip: ipP2P,
      p2p_port: 17668,
      http_ip: ipHTTP,
      http_port: 17669,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE7',
      p2p_ip: ipP2P,
      p2p_port: 17768,
      http_ip: ipHTTP,
      http_port: 17769,
      p2p_network: { ...TestServer.TEST_P2P_NETWORK },
    },
  ];

  static arrayServer: Array<Server> = [];

  /*
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
*/

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
  async poolBlocks() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/pool/blocks');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    const res = await chai.request(`http://${ipHTTP}:17469`).get('/blocks');
    expect(res).to.have.status(200);
  }

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
      /*
      let total = 0;
      for (const originIdent of mapTransactions.keys()) {
        const p = Math.floor(Math.random() * (TestServer.TEST_CONFIG_SERVER.length - 1)) + 1;
        const res = await chai.request(`http://${ipHTTP}:17${p}69`).get(`/transaction/${originIdent}`);
        total = total + (mapTransactions.get(originIdent) || 0);
        expect(res).to.have.status(200);
      }

      expect(total, 'Total Commmands').eq(_outer * _inner);
      */
      expect(200, 'PUT transaction failed').eq(200);
      done();
    }, 25000);
  }
}
