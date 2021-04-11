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

import pino from 'pino';
import path from 'path';

export const Logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: process.env.LOG_LEVEL || 'warn' }
    : { level: process.env.LOG_LEVEL || 'info', prettyPrint: { translateTime: true } },
  process.env.NODE_ENV === 'production'
    ? pino.destination({ dest: path.join(__dirname, '../log/app.log') })
    : pino.destination(1)
);

if (process.env.NODE_ENV !== 'test') {
  process.on(
    'uncaughtException',
    pino.final(Logger, (err, finalLogger) => {
      finalLogger.error(err, 'uncaughtException');
      process.exit(1);
    })
  );

  process.on(
    'unhandledRejection',
    pino.final(Logger, (err, finalLogger) => {
      finalLogger.error(err, 'unhandledRejection');
      process.exit(1);
    })
  );
}
