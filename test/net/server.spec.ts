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
import { Config } from '../../src/config';
import { BlockStruct } from '../../src/chain/block';
import { Blockchain } from '../../src/chain/blockchain';
import { CommandAddPeer, CommandModifyStake } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import fs from 'fs';
import { Logger } from '../../src/logger';

chai.use(chaiHttp);

const SIZE_TESTNET = 17;
const NETWORK_SIZE = 7;
const BASE_PORT = 17000;
const BASE_PORT_FEED = 18000;
const IP = '127.27.27.1';

@suite
class TestServer {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  @timeout(120000)
  static before(): Promise<void> {
    // create a genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../genesis/block.json'));

    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let s = 1;
    for (let i = 1; i <= SIZE_TESTNET; i++) {
      const config = new Config({
        no_bootstrapping: 1,
        ip: IP,
        port: BASE_PORT + i,
        port_block_feed: BASE_PORT_FEED + i,
        path_genesis: path.join(__dirname, '../genesis/block.json'),
        path_state: path.join(__dirname, '../state'),
        path_blockstore: path.join(__dirname, '../blockstore'),
        path_keys: path.join(__dirname, '../keys'),
        network_size: NETWORK_SIZE,
        network_morph_interval_ms: 120000,
        network_verbose_logging: false,
        blockchain_max_blocks_in_memory: 1000,
      });

      const publicKey = Wallet.make(config).getPublicKey();
      TestServer.mapConfigServer.set(publicKey, config);

      cmds.push({
        seq: s,
        command: 'addPeer',
        host: IP,
        port: BASE_PORT + i,
        publicKey: publicKey,
      } as CommandAddPeer);
      s++;
      cmds.push({
        seq: s,
        command: 'modifyStake',
        publicKey: publicKey,
        stake: Math.floor((Math.random() * 1000) / Math.sqrt(i)), // i > 7 ? 0 : 1000,
      } as CommandModifyStake);
      s++;
    }
    genesis.tx = [
      {
        ident: 'genesis',
        origin: '0000000000000000000000000000000000000000000',
        commands: cmds,
        sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      },
    ];
    fs.writeFileSync(path.join(__dirname, '../genesis/block.json'), JSON.stringify(genesis));

    return new Promise((resolve) => {
      setTimeout(resolve, SIZE_TESTNET * 1000);

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
      TestServer.mapServer.forEach(async (s) => {
        await s.shutdown();
        c--;
        if (!c) {
          setTimeout(resolve, 500);
        }
      });
    });
  }

  static async createServer(publicKey: string) {
    const s = new Server(
      new Config({
        ...TestServer.mapConfigServer.get(publicKey),
        ...{
          path_genesis: path.join(__dirname, '../genesis/block.json'),
          path_blockstore: path.join(__dirname, '../blockstore'),
          path_state: path.join(__dirname, '../state'),
          path_keys: path.join(__dirname, '../keys'),
        },
      })
    );
    await s.start();
    TestServer.mapServer.set(publicKey, s);
    return s;
  }

  @test
  async default404() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  @slow(150000)
  @timeout(150000)
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
      await TestServer.wait(500);
    }

    console.log('waiting for sync...');
    // wait for a possible sync
    await TestServer.wait(10000);
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
    console.log(res.body);
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
    console.log(`http://${arrayConfig[0].ip}:${arrayConfig[0].port}`);
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
    const _outer = 100; // transactions
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
        Logger.trace(`${_i}: http://${arrayConfig[i].ip}:${arrayConfig[i].port}`);
        const res = await chai
          .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
          .put('/transaction')
          .send(aT);
        arrayTimestamp.push(new Date().getTime());
        arrayRequests.push(arrayOrigin[i]);
        arrayIdents.push(res.body.ident);
      } catch (error) {
        console.error(error);
      }
      await TestServer.wait(1 + Math.floor(Math.random() * 200));
    }

    Logger.trace('waiting for sync');
    // wait for a possible sync
    await TestServer.wait(30000);

    // all blockchains have to be equal
    let arrayBlocks: Array<any> = [];
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

    // number of transactions must match expectations
    const res = await chai.request(`http://${arrayConfig[0].ip}:${arrayConfig[0].port}`).get('/blocks/2');
    arrayBlocks = res.body;
    let amountTransactions = 0;
    arrayBlocks.forEach((b: BlockStruct) => {
      amountTransactions += b.tx.length;
    });
    console.log('Transactions check: ' + amountTransactions);

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
