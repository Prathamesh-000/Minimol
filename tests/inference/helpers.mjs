import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { decodeShard } from '../../dist/inference/weightLoader.js';

export const root = new URL('../../', import.meta.url);
export const manifest = JSON.parse(await readFile(new URL('public/model/manifest.json', root), 'utf8'));
export const golden = JSON.parse(await readFile(new URL('tests/fixtures/golden_vectors.json', root), 'utf8'));
export async function roleBytes(role) {
  const data = await readFile(new URL(`public/model/${role}.bin`, root));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
const shards = new Map();
export function loadShard(role) {
  if (!shards.has(role)) shards.set(role, roleBytes(role).then(bytes => decodeShard(role, manifest, bytes)));
  return shards.get(role);
}
export function closeArray(actual, expected, atol = 1e-4, rtol = 1e-4) {
  assert.equal(actual.length, expected.length);
  let maximum = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    assert.ok(Number.isFinite(actual[i]) && error <= atol + rtol * Math.abs(expected[i]), `index ${i}: ${actual[i]} vs ${expected[i]}, error ${error}`);
    maximum = Math.max(maximum, error);
  }
  return maximum;
}
