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

'use strict';

import { Wallet } from './wallet';

export class Validators {
  list: Array<string>;

  constructor(numberOfValidators: number) {
    this.list = Validators.generateAddresses(numberOfValidators);
  }

  // @FIXME
  static generateAddresses(numberOfValidators: number): Array<string> {
    const list = [];
    for (let i = 0; i < numberOfValidators; i++) {
      list.push(new Wallet('NODE' + i).getPublicKey());
    }
    return list;
  }

  isValid(publicKey: string): boolean {
    return this.list.includes(publicKey);
  }
}
