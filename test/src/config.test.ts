/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { assertEquals, assertExists } from '@std/assert';
import { Config, DEFAULT_IP, DEFAULT_PORT } from '../../src/config.ts';

Deno.test('Config - Defaults & Initialization', () => {
  const rawConfig = {
    path_keystore: 'db/test_keystore.enc',
    i2p_sam_http: '127.0.0.1:7656',
  } as Config;

  const config = Config.make(rawConfig);

  assertEquals(config.ip, DEFAULT_IP);
  assertEquals(config.port, DEFAULT_PORT);
  assertEquals(config.path_keystore, 'db/test_keystore.enc');
  assertEquals(config.i2p_sam_http, '127.0.0.1:7656');
  assertExists(config.VERSION);
});

Deno.test('Config - Environment Variable Overrides & Boundary Clamping', () => {
  Deno.env.set('IS_TESTNET', 'false');
  Deno.env.set('BOOTSTRAP', '127.0.0.1:17468');
  Deno.env.set('PORT', '8080');
  Deno.env.set('NETWORK_TIMEOUT_MS', '999999'); // Should clamp to max
  Deno.env.set('I2P_SAM_TUNNEL_VAR_MIN', '1');
  Deno.env.set('I2P_SAM_TUNNEL_VAR_MAX', '2');

  try {
    const rawConfig = {} as Config;
    const config = Config.make(rawConfig);

    assertEquals(config.is_testnet, false);
    assertEquals(config.bootstrap, '127.0.0.1:17468');
    assertEquals(config.port, 8080);
    assertEquals(config.network_timeout_ms, 60000); // Clamped max value
    assertEquals(config.i2p_sam_tunnel_var_min, 1);
    assertEquals(config.i2p_sam_tunnel_var_max, 2);
  } finally {
    Deno.env.delete('IS_TESTNET');
    Deno.env.delete('BOOTSTRAP');
    Deno.env.delete('PORT');
    Deno.env.delete('NETWORK_TIMEOUT_MS');
    Deno.env.delete('I2P_SAM_TUNNEL_VAR_MIN');
    Deno.env.delete('I2P_SAM_TUNNEL_VAR_MAX');
  }
});
