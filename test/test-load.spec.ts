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

chai.use(chaiHttp);

const ipP2P = '172.20.101.1';
const ipHTTP = '127.0.0.1';

@suite
class TestLoad {
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
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE2',
      p2p_ip: ipP2P,
      p2p_port: 17268,
      http_ip: ipHTTP,
      http_port: 17269,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE3',
      p2p_ip: ipP2P,
      p2p_port: 17368,
      http_ip: ipHTTP,
      http_port: 17369,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE4',
      p2p_ip: ipP2P,
      p2p_port: 17468,
      http_ip: ipHTTP,
      http_port: 17469,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE5',
      p2p_ip: ipP2P,
      p2p_port: 17568,
      http_ip: ipHTTP,
      http_port: 17569,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE6',
      p2p_ip: ipP2P,
      p2p_port: 17668,
      http_ip: ipHTTP,
      http_port: 17669,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
    {
      secret: 'NODE7',
      p2p_ip: ipP2P,
      p2p_port: 17768,
      http_ip: ipHTTP,
      http_port: 17769,
      p2p_network: { ...TestLoad.TEST_P2P_NETWORK },
    },
  ];

  @test
  @slow(10000)
  @timeout(10000)
  createMultiTransactionBlock(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 9000);

      // create a block containing multiple transactions
      for (let j = 1; j <= TestLoad.TEST_CONFIG_SERVER.length; j++) {
        setTimeout(async () => {
          const res = await chai.request(`http://${ipHTTP}:17${j}69`).put('/block').send([j]);
          expect(res).to.have.status(200);
        }, 3000);
      }
    });
  }
}
