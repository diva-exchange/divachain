/**
 * Copyright (C) 2021-2026 diva.exchange
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

import { join as joinPath } from 'node:path';
import { stdout } from 'node:process';
import pino from 'pino';

let _LoggerLog: pino.Logger = {} as pino.Logger;

export class Logger {
  public static make(pathLog: string, level: string = 'trace') {
    if (pathLog !== 'stdout') {
      pathLog = joinPath(Deno.cwd(), pathLog);
      if (!pathLog.endsWith('.log')) {
        pathLog = joinPath(pathLog, 'diva.log');
      }
    }
    _LoggerLog = pino(
      {
        level: level,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination(pathLog === 'stdout' ? stdout : pathLog),
    );
    _LoggerLog.info(`Application root: ${Deno.cwd()}`);
    _LoggerLog.info(`Application log (${level}): ${pathLog}`);
  }
}

export { _LoggerLog as 'Log' };
