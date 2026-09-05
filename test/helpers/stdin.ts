/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export function mockStdinRead(
  readFn?: (p: Uint8Array) => Promise<number | null>,
) {
  const originalStdinRead = Deno.stdin.read;

  Deno.stdin.read = readFn ||
    (async (p: Uint8Array): Promise<number | null> => {
      const pass = new TextEncoder().encode('test_passphrase\n');
      p.set(pass);
      return pass.length;
    });

  return () => {
    Deno.stdin.read = originalStdinRead;
  };
}
