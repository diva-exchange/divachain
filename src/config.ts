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

export const HTTP_IP = process.env.HTTP_IP || '127.0.0.1';
export const HTTP_PORT = Number(process.env.HTTP_PORT) || 17169;

export const P2P_IP = process.env.P2P_IP || '127.0.0.1';
export const P2P_PORT = Number(process.env.P2P_PORT) || 17168;
export const P2P_NETWORK = {
  '8IokiGIWO1tZv3STHERC0Vq3-obO0uBnKh9UvVKOSlc': {
    host: '47hul5deyozlp5juumxvqtx6wmut5ertroga3gej4wtjlc6wcsya.b32.i2p',
    port: 17168,
  },
  HJT9oYoNO9N_K0pOQpAuV8KB4mbFTMccqOf68zrAGFw: {
    host: 'o4jj2ldln3eelvqtc3hbauge274a4wun7nrnlnv54v44p6pz4lwa.b32.i2p',
    port: 17268,
  },
  'HKBpJ48a-jTQrugsnHHDTuaMJmOIzcz_HcV9KumsQ6A': {
    host: 'yi2yzuqjeu7bvcltpdhlcwozdrfvhwvr42wgysmsoocw72vu5rca.b32.i2p',
    port: 17368,
  },
  '2c3oqISpJzXDjdMqLZHJZ0l-gfMY_jsL8OzYKbbL-Xw': {
    host: 'xnwjn3ohhzcdgiofyizctgkehcztdl2fcqamp3exmrvwqyrjmwkq.b32.i2p',
    port: 17468,
  },
  'onOB79NAtZxjBdjt6Ea9kuXviJL31lQ7jG2DA-2WCbs': {
    host: '2mrfppk2yvbt6jhnfc2lqcjtbaht4rfrvypx4xydstt5ku5rnoaa.b32.i2p',
    port: 17568,
  },
  'ncCsviOQEaimSMeOxAhvj5tx09g5lHzEo4I-odliVX8': {
    host: 'lxkfr2flou6d5w6bcvysnqbczutyh4msklvswkzwne7lqfuk5tia.b32.i2p',
    port: 17668,
  },
  jPbhjJUVAs6h0JyILk5nwfdWsPHB_FsU6hPn_LpQuXY: {
    host: '6trjttkmca36b25e2khdisgd6wns4luhchaepevbqkmpvqn6xjmq.b32.i2p',
    port: 17768,
  },
};

export const NUMBER_OF_NODES = 7;

export const MIN_APPROVALS = 2 * (NUMBER_OF_NODES / 3) + 1; // PBFT
