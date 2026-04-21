/**
 * Copyright (C) 2026 diva.exchange
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

import { crypto } from 'jsr:@std/crypto/crypto';
import { encodeBase64Url } from 'jsr:@std/encoding';
import { concat } from 'jsr:@std/bytes';

Deno.test('Map to JSON', () => {
  const m: Map<string, Array<object>> = new Map();
  m.set('k', [{ skew: 10, matrix: [1, 2, 3] }]);

  console.log(JSON.stringify(Array.from(m)));
  console.log(JSON.stringify(Object.fromEntries(m.entries())));
  console.log(JSON.stringify(m));
});

Deno.test('Crypto Uint8Array', async () => {
  let a: Uint8Array = new TextEncoder().encode(crypto.randomUUID());
  console.log(new TextDecoder().decode(a));
  const hash = new Uint8Array(
    await crypto.subtle.digest('BLAKE3', a as BufferSource),
  );
  const s: string = `[${hash.toString()}]`;
  console.log(s);
  let b: Uint8Array = new Uint8Array(JSON.parse(s));
  console.log(b.toString());
});

Deno.test('Crypto Blake3', async () => {
  const pl: string = '22214630-ce6a-4a03-b532-97ff059cf429'; //crypto.randomUUID();
  const _pl: Uint8Array = new TextEncoder().encode(pl);
  let hash: Uint8Array;
  let n: number = -1;
  let nB: Uint8Array;
  const timeStart: number = performance.now();
  do {
    n++;
    nB = new Uint8Array(new Uint32Array([n]).buffer);
    const d: BufferSource = concat([_pl, nB]);
    hash = new Uint8Array(await crypto.subtle.digest('BLAKE3', d));
  } while (!_hasDifficultyPoW(3, hash));
  const timeEnd: number = performance.now();
  console.log(`${Math.round(timeEnd - timeStart) / 1000} secs`);
  console.log(`${Math.round(timeEnd - timeStart) / n} ms per trial`);

  console.log(`n: ${n}`);
  console.log(`hash: ${hash.byteLength} ${hash.slice(0, 8)}`);
  const rHash: Uint8Array = concat([nB, hash]);
  console.log(`result: ${rHash.byteLength} ${rHash.slice(0, 8)}`);
  const r: string = encodeBase64Url(rHash);
  // const r: string = encodeBase64Url(
  //   concat([_hash, new Uint8Array(new Uint32Array([n]))]),
  // );
  console.log(`base64: ${r.length} ${r}`);
  console.log(new Uint32Array(rHash.slice(0, 4).buffer));
  console.log(
    `reverse n: ${new Uint32Array(rHash.slice(0, 4).buffer)[0]}`,
  );
});

function _hasDifficultyPoW(c: number, hash: Uint8Array): boolean {
  for (let i = 0; i < c; i++) {
    if (hash[i] > 0) return false;
  }
  return true;
}
