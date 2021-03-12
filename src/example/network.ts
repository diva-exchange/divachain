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

import { Network } from '../p2p/network';
import { Transaction } from '../p2p/message/transaction';

const ip = process.env.IP || '172.20.101.1';
const port = Number(process.env.PORT) || 17168;

const n = new Network({
  ip: ip,
  port: port,
  networkPeers: {
    f08a248862163b5b59bf74931c4442d15ab7fa86ced2e0672a1f54bd528e4a57: {
      host: '47hul5deyozlp5juumxvqtx6wmut5ertroga3gej4wtjlc6wcsya.b32.i2p',
      port: 17168,
    },
    '1c94fda18a0d3bd37f2b4a4e42902e57c281e266c54cc71ca8e7faf33ac0185c': {
      host: 'o4jj2ldln3eelvqtc3hbauge274a4wun7nrnlnv54v44p6pz4lwa.b32.i2p',
      port: 17268,
    },
    '1ca069278f1afa34d0aee82c9c71c34ee68c266388cdccff1dc57d2ae9ac43a0': {
      host: 'yi2yzuqjeu7bvcltpdhlcwozdrfvhwvr42wgysmsoocw72vu5rca.b32.i2p',
      port: 17368,
    },
  },
});

setInterval(() => {
  n.broadcast(
    new Transaction().create({
      id: '1',
      publicKey: 'gah',
      input: `FROM: ${ip}:${port} @${Date.now()}`,
      signature: 'gah',
    })
  );
}, 100);
