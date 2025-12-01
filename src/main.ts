/**
 * Copyright (C) 2025-2026 diva.exchange
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

import { exists } from '@std/fs';
import { join as joinPath } from 'node:path';
import { Config } from './config.ts';
import { Server } from './net/server.ts';
import { Log, Logger } from './logger.ts';

type functionCallback = () => void;

class Main {
  private static pathConfig: string;
  private static config: Config = {} as Config;

  /**
   * Run main program
   */
  static async run() {
    // initialize environment and logging
    Main.env();

    // is it a genesis generation process?
    if (Deno.env.get('GENESIS')) {
      const mod = await import('./genesis.ts');
      await mod.Genesis.create();
      Deno.exit(0);
    }

    // check configuration file
    Main.config = await Main.checkConfig();

    // start main process
    const server: Server = new Server(Main.config);

    // termination handlers
    const signalShutdown: functionCallback = async () => {
      await server.shutdown();
      Deno.exit(0);
    };
    Deno.addSignalListener('SIGINT', signalShutdown);
    Deno.addSignalListener('SIGTERM', signalShutdown);
    Deno.build.os === 'windows' &&
      Deno.addSignalListener('SIGBREAK', signalShutdown);
  }

  // set environment
  //   development or production, defaults to development
  // set log level
  private static env() {
    switch (Deno.env.get('DIVA_ENV') || '') {
      case 'production':
      case 'prod':
      case 'main':
      case 'mainnet':
        Deno.env.set('DIVA_ENV', 'prod');
        break;
      case 'test':
      case 'testnet':
        Deno.env.set('DIVA_ENV', 'test');
        break;
      default:
        Deno.env.set('DIVA_ENV', 'dev');
    }

    if (Deno.env.get('GENESIS')) {
      Logger.make('stdout', 'trace');
      return;
    }

    // set a valid log level
    let level: string = Deno.env.get('LOG_LEVEL') || '';
    switch (level) {
      case 'trace':
      case 'debug':
      case 'info':
      case 'warn':
      case 'error':
      case 'fatal':
        break;
      default:
        level = Deno.env.get('DIVA_ENV') === 'dev' ? 'trace' : 'info';
    }
    Deno.env.set('LOG_LEVEL', level);
  }

  private static async checkConfig(): Promise<Config> {
    let c: Config = {} as Config;
    try {
      Main.pathConfig = Main.cleanPath(
        Deno.env.get('PATH_CONFIG') || 'config.json',
      );
      if (!(await exists(Main.pathConfig, { isFile: true }))) {
        throw new Error('Environment variable PATH_CONFIG invalid');
      } else {
        c = JSON.parse(await Deno.readTextFile(Main.pathConfig));

        // initialize application log
        const _p: string = Deno.env.get('PATH_LOG') || c.path_log || 'stdout';
        Logger.make(_p, Deno.env.get('LOG_LEVEL'));

        Main.checkConfigPath(c, 'path_keys');
        Main.checkConfigPath(c, 'path_chain');
        Main.checkConfigPath(c, 'path_state');
        if (
          !c.path_genesis || !(await exists(c.path_genesis)) ||
          !/\.json$/.test(c.path_genesis)
        ) {
          throw new Error(
            'Invalid configuration file, path_genesis invalid: ' +
              Main.pathConfig,
          );
        }
        Log.info('Application configuration: ' + Main.pathConfig);
      }
    } catch (e: unknown) {
      console.error('FATAL, INIT FAILED: ' + (e as Error).message);
      Deno.exit(1);
    }

    return await Config.make(c);
  }

  private static async checkConfigPath(c: Config, key: string) {
    const path: string = Object(c)[key] || '';
    if (!path) {
      throw new Error(
        `Invalid configuration file, "${key}" missing: ${Main.pathConfig}`,
      );
    }

    if (!(await exists(path, { isDirectory: true }))) {
      throw new Error(
        `Invalid configuration: "${key}". Path ${path} not found: ${Main.pathConfig}`,
      );
    }
  }

  private static cleanPath(path: string): string {
    return joinPath(Deno.cwd(), path.replace(/^[./\\]+/, ''));
  }
}

Main.run();
