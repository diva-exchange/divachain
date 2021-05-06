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

import { Build } from './build';
import { CreateI2P } from './create-i2p';

export const DEFAULT_NETWORK_SIZE = 7;
export const MAX_NETWORK_SIZE = 64;

export const DEFAULT_BASE_DOMAIN = 'testnet.diva.i2p';
export const DEFAULT_BASE_IP = '172.19.72.';
export const DEFAULT_PORT_P2P = 17468;

if ((process.env.CREATE_I2P || 0) > 0) {
  new CreateI2P(Number(process.env.SIZE_NETWORK) || DEFAULT_NETWORK_SIZE);
} else {
  new Build(Number(process.env.SIZE_NETWORK) || DEFAULT_NETWORK_SIZE);
}
