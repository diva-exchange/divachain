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

import { suite, test } from '@testdeck/mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

import { Config, Configuration, DEFAULT_NAME_GENESIS_BLOCK } from '../src/config';

@suite
class TestConfig {
  static async before(): Promise<void> {
    fs.copyFileSync(
      path.join(__dirname, '../genesis/block.json'),
      path.join(__dirname, 'genesis/', DEFAULT_NAME_GENESIS_BLOCK) + '.json'
    );
  }

  @test
  async config() {
    const c = await Config.make({
      path_genesis: path.join(__dirname, 'genesis/', DEFAULT_NAME_GENESIS_BLOCK) + '.json',
      i2p_sam_host: '172.19.75.11',
      network_size: 100,
    } as Configuration);
    expect(c.ip).is.not.empty;
    expect(c.network_size).is.equal(64);

    try {
      await Config.make({
        no_bootstrapping: 1,
        path_app: __dirname,
        path_blockstore: '/tmp',
        path_keys: '/tmp',
        path_state: '/tmp',
      } as Configuration);
      expect(false).to.be.true;
    } catch (error: any) {
      expect(error.toString()).to.contain('invalid address');
    }
  }

  @test
  async failPathApp() {
    try {
      await Config.make({
        path_app: '/tmp/',
      } as Configuration);
      expect(false).to.be.true;
    } catch (error: any) {
      expect(error.toString()).to.contain('package.json');
    }
  }

  @test
  async failGenesis() {
    process.env.NAME_BLOCK_GENESIS = '-';
    try {
      await Config.make({ path_app: __dirname, path_genesis: path.join(__dirname, 'fail-genesis') } as Configuration);
      expect(false).to.be.true;
    } catch (error: any) {
      expect(error.toString()).to.contain('not found');
    } finally {
      process.env.NAME_BLOCK_GENESIS = DEFAULT_NAME_GENESIS_BLOCK;
    }
  }

  @test
  async I2P() {
    const c1 = await Config.make({
      path_app: __dirname,
      path_genesis: path.join(__dirname, 'genesis/'),
      i2p_socks_host: '172.19.75.11',
      i2p_sam_host: '172.19.75.11',
    } as Configuration);
    expect(c1.i2p_has_socks).to.be.true;
    expect(c1.i2p_has_sam).to.be.true;

    const c2 = await Config.make({
      path_app: __dirname,
      path_genesis: path.join(__dirname, 'genesis/'),
      address: c1.address,
      i2p_socks_host: '172.19.75.11',
      i2p_sam_host: '172.19.75.11',
    } as Configuration);
    expect(c2.address).to.be.equal(c1.address);
    fs.unlinkSync(path.join(c2.path_keys, c1.address));

    try {
      await Config.make({
        path_app: __dirname,
        path_genesis: path.join(__dirname, 'genesis/'),
        address: c1.address,
        i2p_socks_host: '172.19.75.11',
        i2p_sam_host: '172.19.75.11',
      } as Configuration);
      expect(false).to.be.true;
    } catch (error: any) {
      expect(error.toString()).to.contain('invalid I2P address');
    }
  }

  @test
  async failI2P() {
    const c1 = await Config.make({
      path_app: __dirname,
      path_genesis: path.join(__dirname, 'genesis/'),
      address: '127.27.27.1:17001',
      i2p_socks_host: '127.27.26.25',
      i2p_sam_host: '127.27.26.25',
    } as Configuration);
    expect(c1.i2p_has_socks).to.be.false;
    expect(c1.i2p_has_sam).to.be.false;
  }

  @test
  async configNetworkRefreshIntervalMs() {
    const c = await Config.make({
      address: '127.27.27.1:17001',
      path_app: __dirname,
      network_p2p_interval_ms: -1,
    } as Configuration);
    expect(c.network_p2p_interval_ms).is.greaterThanOrEqual(1);
    expect(c.network_p2p_interval_ms).is.equal(3000);
  }
}
