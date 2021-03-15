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

import { Network } from '../src/p2p/network';
import { Transaction } from '../src/p2p/message/transaction';

const ip = process.env.IP || '172.20.101.1';
const port = Number(process.env.PORT) || 17168;

const n = new Network({
  ip: ip,
  port: port,
  networkPeers: {
    '8IokiGIWO1tZv3STHERC0Vq3+obO0uBnKh9UvVKOSlc': {
      host: '47hul5deyozlp5juumxvqtx6wmut5ertroga3gej4wtjlc6wcsya.b32.i2p',
      port: 17168,
    },
    'HJT9oYoNO9N/K0pOQpAuV8KB4mbFTMccqOf68zrAGFw': {
      host: 'o4jj2ldln3eelvqtc3hbauge274a4wun7nrnlnv54v44p6pz4lwa.b32.i2p',
      port: 17268,
    },
    'HKBpJ48a+jTQrugsnHHDTuaMJmOIzcz/HcV9KumsQ6A': {
      host: 'yi2yzuqjeu7bvcltpdhlcwozdrfvhwvr42wgysmsoocw72vu5rca.b32.i2p',
      port: 17368,
    },
    '2c3oqISpJzXDjdMqLZHJZ0l+gfMY/jsL8OzYKbbL+Xw': {
      host: 'xnwjn3ohhzcdgiofyizctgkehcztdl2fcqamp3exmrvwqyrjmwkq.b32.i2p',
      port: 17468,
    },
    'onOB79NAtZxjBdjt6Ea9kuXviJL31lQ7jG2DA+2WCbs': {
      host: '2mrfppk2yvbt6jhnfc2lqcjtbaht4rfrvypx4xydstt5ku5rnoaa.b32.i2p',
      port: 17568,
    },
    'ncCsviOQEaimSMeOxAhvj5tx09g5lHzEo4I+odliVX8': {
      host: 'lxkfr2flou6d5w6bcvysnqbczutyh4msklvswkzwne7lqfuk5tia.b32.i2p',
      port: 17668,
    },
    'jPbhjJUVAs6h0JyILk5nwfdWsPHB/FsU6hPn/LpQuXY': {
      host: '6trjttkmca36b25e2khdisgd6wns4luhchaepevbqkmpvqn6xjmq.b32.i2p',
      port: 17768,
    },
  },
});

setInterval(() => {
  n.broadcast(
    new Transaction().create({
      id: '1',
      publicKey: 'foo',
      input: `FROM: ${ip}:${port} @${Date.now()}`,
      signature: 'bar',
    })
  );
}, 100);
