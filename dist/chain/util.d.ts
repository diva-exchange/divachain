/**
 * Copyright (C) 2021-2024 diva.exchange
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
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */
import { TxStruct } from './tx.js';
export declare class Util {
    static hash(tx: TxStruct): string;
    static verifySignature(publicKey: string, sig: string, data: string): boolean;
    /**
     * Shuffle an array, using Durstenfeld shuffle
     * https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
     *
     * @param {Array<any>} array
     * @return {Array<any>} A copy of the array
     */
    static shuffleArray(array: Array<any>): Array<any>;
    /**
     * Calculate quartile coefficient of dispersion of an array of numbers
     * https://en.wikipedia.org/wiki/Quartile_coefficient_of_dispersion
     */
    static QuartileCoeff(array: Array<number>): number;
    static stringDiff(a: string, b: string): number;
}
