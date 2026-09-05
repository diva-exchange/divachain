/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { dirname, isAbsolute, join as joinPath } from 'node:path';
import { stdout } from 'node:process';
import pino from 'pino';

let _LoggerLog: pino.Logger = pino({
  level: Deno.env.get('LOG_LEVEL') || 'silent',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
  },
});

let _TelemetryLog: pino.Logger = pino({ level: 'silent' });

export class Logger {
  public static make(pathLog: string, level: string = 'trace') {
    if (pathLog !== 'stdout') {
      if (!isAbsolute(pathLog)) {
        pathLog = joinPath(Deno.cwd(), pathLog);
      }
      if (!pathLog.endsWith('.log')) {
        pathLog = joinPath(pathLog, 'diva.log');
      }
    }

    _LoggerLog = pino(
      {
        level: level,
        timestamp: pino.stdTimeFunctions.isoTime,
        serializers: {
          err: pino.stdSerializers.err,
        },
      },
      pino.destination(pathLog === 'stdout' ? stdout : pathLog),
    );

    // Initialize dedicated Telemetry Logger
    if (pathLog !== 'stdout') {
      const dir = dirname(pathLog);
      const telemetryPath = joinPath(dir, 'diva-telemetry.log');
      _TelemetryLog = pino(
        {
          level: 'info',
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.destination(telemetryPath),
      );
    } else {
      _TelemetryLog = pino(
        {
          level: 'info',
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.destination(stdout),
      );
    }

    _LoggerLog.info(`Application root: ${Deno.cwd()}`);
    _LoggerLog.info(`Application log (${level}): ${pathLog}`);
  }
}

export { _LoggerLog as 'Log', _TelemetryLog as 'Telemetry' };
