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

import { suite, test } from '@testdeck/mocha';
import { expect } from 'chai';

import { Config } from '../../dist/config.js';
import path from 'path';
import fs from 'fs';

@suite
class TestConfig {
  static before() {
    process.env.SIZE_TESTNET = process.env.SIZE_TESTNET || '11';
    process.env.IP = process.env.IP || '0.0.0.0';
    process.env.I2P_SOCKS = '172.19.75.11:4445';
    process.env.I2P_SAM_HTTP = '172.19.75.11:7656';
    process.env.I2P_SAM_TCP = '172.19.75.12:7656';
    process.env.I2P_SAM_FORWARD_HTTP = process.env.I2P_SAM_FORWARD_HTTP || '172.19.75.1:17000';
    process.env.I2P_SAM_LISTEN_TCP = process.env.I2P_SAM_LISTEN_TCP || '0.0.0.0:17001';
    process.env.I2P_SAM_FORWARD_TCP = process.env.I2P_SAM_FORWARD_TCP || '172.19.75.1:17001';
    process.env.DEBUG_PERFORMANCE = '1';
  }

  @test
  async config(): Promise<void> {
    const ___dirname: string = fs.realpathSync(path.dirname(import.meta.url.replace(/^file:\/\//, '')) + '/../');
    const c: Config = await Config.make({ path_app: ___dirname, path_genesis: path.join(___dirname, '/../genesis/') });
    expect(c.ip).is.not.empty;
  }
}
