/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists } from '@std/assert';
import { existsSync } from '@std/fs';
import path from 'node:path';
import { Log, Logger } from '../../src/logger.ts';

Deno.test('Logger - make("stdout") initialization', () => {
  Logger.make('stdout', 'info');

  assertExists(Log);
  assertEquals(typeof Log.info, 'function');
  assertEquals(typeof Log.error, 'function');

  // Verify logging method works without throwing
  Log.info('Test stdout log message');
});

Deno.test('Logger - make() with directory path creates diva.log', () => {
  const tempDir = Deno.makeTempDirSync();

  try {
    Logger.make(tempDir, 'debug');

    const expectedLogFile = path.join(tempDir, 'diva.log');
    assertEquals(existsSync(expectedLogFile), true);

    Log.debug('Test file log message');
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test('Logger - make() with explicit file path', () => {
  const tempDir = Deno.makeTempDirSync();
  const customLogPath = path.join(tempDir, 'custom_output.log');

  try {
    Logger.make(customLogPath, 'trace');

    assertEquals(existsSync(customLogPath), true);

    Log.trace('Test custom file log message');
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});
