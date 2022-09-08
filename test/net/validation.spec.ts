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
import { Validation } from '../../src/net/validation';
import { Message } from '../../src/net/message/message';
import { Wallet } from '../../src/chain/wallet';
import { Config } from '../../src/config';
import path from 'path';
import { nanoid } from 'nanoid';

@suite
class TestValidation {
  private static config: Config;
  private static wallet: Wallet;

  static async before() {
    process.env.SIZE_TESTNET = process.env.SIZE_TESTNET || '9';
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

    TestValidation.config = await Config.make({ path_app: __dirname });
    TestValidation.wallet = Wallet.make(TestValidation.config);
  }

  static after() {
    TestValidation.wallet.close();
  }
}
