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

import { Logger } from '../src/logger';
import { Config, Configuration } from '../src/config';
import fs from 'fs';

@suite
class TestConfigLogger {
  @test
  config() {
    const c = new Config({ network_refresh_interval_ms: 5000, network_size: 100 } as Configuration);
    expect(c.ip).is.not.empty;
    expect(c.network_refresh_interval_ms).is.equal(5000);
    expect(c.network_size).is.equal(64);
  }

  @test
  configPkg() {
    process['pkg'] = true;
    process.execPath = __filename;
    const c = new Config({} as Configuration);
    expect(c.ip).is.not.empty;
  }

  @test
  logger() {
    process.env.NODE_ENV = 'development';
    expect(Logger).is.not.undefined;
  }

  @test
  configPathExist() {
    fs.rmdirSync(__dirname + '/blockstore', { recursive: true });
    fs.rmdirSync(__dirname + '/state', { recursive: true });
    fs.rmdirSync(__dirname + '/keys', { recursive: true });
    const c = new Config({ path_app: __dirname } as Configuration);
    expect(c.ip).is.not.empty;
  }

  @test
  configNetworkRefreshIntervalMs() {
    const c = new Config({ path_app: __dirname, network_refresh_interval_ms: -1 } as Configuration);
    expect(c.network_refresh_interval_ms).is.greaterThanOrEqual(1);
    expect(c.network_refresh_interval_ms).is.equal(3000);
  }
}
