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

export const MIN_APPROVALS = 2 * (Object.keys(P2P_NETWORK).length / 3) + 1; // PBFT
