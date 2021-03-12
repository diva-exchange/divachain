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

export const TRANSACTION_THRESHOLD = 1;

export const NUMBER_OF_NODES = 3;

export const MIN_APPROVALS = 2 * (NUMBER_OF_NODES / 3) + 1; // PBFT
