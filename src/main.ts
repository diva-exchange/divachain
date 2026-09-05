/**
 * Copyright (C) 2025-2026 diva.exchange
 *
 * See /LICENSE file for details.
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
  private static server?: Server; // static for shutdown

  /**
   * Run main program
   */
  static async run() {
    Main.env();

    globalThis.addEventListener('unhandledrejection', async (e) => {
      e.preventDefault();
      const stack = e.reason && e.reason.stack ? e.reason.stack : e.reason;
      Log.fatal(`UNHANDLED REJECTION:\n${stack}`);
      await Main.shutdown(9);
    });

    globalThis.addEventListener('error', async (e) => {
      e.preventDefault();
      const stack = e.error && e.error.stack ? e.error.stack : e.message;
      Log.fatal(`UNCAUGHT EXCEPTION:\n${stack}`);
      await Main.shutdown(9);
    });

    if (Deno.env.get('GENESIS')) {
      const mod = await import('./genesis.ts');
      await mod.Genesis.create();
      Deno.exit(0);
    }

    Main.config = await Main.checkConfig();

    Main.server = new Server(Main.config);
    await Main.server.init();

    const signalShutdown: functionCallback = async () => {
      await Main.shutdown(0);
    };
    Deno.addSignalListener('SIGINT', signalShutdown);
    Deno.addSignalListener('SIGTERM', signalShutdown);
    Deno.build.os === 'windows' &&
      Deno.addSignalListener('SIGBREAK', signalShutdown);
  }

  private static async shutdown(code: number) {
    if (Main.server) {
      try {
        await Main.server.shutdown();
      } catch (err) {
        Log.error(`Shutdown error: ${(err as Error).message}`);
      }
    }
    Log.flush();
    Deno.exit(code);
  }

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

        const _p: string = Deno.env.get('PATH_LOG') || c.path_log || 'stdout';
        Logger.make(_p, Deno.env.get('LOG_LEVEL'));

        if (!c.path_keystore || !/\.enc$/.test(c.path_keystore)) {
          throw new Error(
            'Invalid configuration file, path_keystore invalid (must end with .enc): ' +
              Main.pathConfig,
          );
        }
        const keystoreDir = c.path_keystore.substring(
          0,
          c.path_keystore.lastIndexOf('/'),
        );
        if (
          keystoreDir && !(await exists(keystoreDir, { isDirectory: true }))
        ) {
          throw new Error(
            `Invalid configuration: Keystore directory ${keystoreDir} not found: ${Main.pathConfig}`,
          );
        }

        Main.checkConfigPath(c, 'path_consensus');
        Main.checkConfigPath(c, 'path_soc');
        Main.checkConfigPath(c, 'path_soc_index');

        if (
          c.path_genesis_consensus &&
          (!(await exists(c.path_genesis_consensus)) ||
            !/\.json$/.test(c.path_genesis_consensus))
        ) {
          throw new Error(
            'Invalid configuration file, path_genesis_consensus invalid: ' +
              Main.pathConfig,
          );
        }

        if (
          !c.path_genesis_soc || !(await exists(c.path_genesis_soc)) ||
          !/\.json$/.test(c.path_genesis_soc)
        ) {
          throw new Error(
            'Invalid configuration file, path_genesis_chain invalid: ' +
              Main.pathConfig,
          );
        }

        Log.info('Application configuration: ' + Main.pathConfig);
      }
    } catch (e: unknown) {
      if (typeof Log !== 'undefined') {
        Log.fatal('FATAL, INIT FAILED: ' + (e as Error).message);
      } else {
        console.error('FATAL, INIT FAILED: ' + (e as Error).message);
      }
      Deno.exit(1);
    }

    return Config.make(c);
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
