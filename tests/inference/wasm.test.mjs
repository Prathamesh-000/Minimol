import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { instantiateWasmBackend, selectBackend } from '../../dist/inference/wasmBackend.js';
import { scalarBackend } from '../../dist/inference/matrixMultiply.js';
import { Phone1Engine } from '../../dist/inference/phone1Engine.js';
import { Phone2Engine } from '../../dist/inference/phone2Engine.js';
import { loadShard, root, golden, closeArray } from './helpers.mjs';

async function bytesFor(variant) { const b = await readFile(new URL(`public/wasm/matrix-${variant}.wasm`, root)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

for (const variant of ['scalar', 'simd']) {
  test(`compiled WASM ${variant} matrix kernel matches scalar FP32 reduction exactly`, async () => {
    const bytes = await bytesFor(variant), module = await WebAssembly.compile(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const backend = await instantiateWasmBackend(bytes, 'phone1');
    assert.equal(backend.name, `wasm-${variant}`);
    for (const [rows, cols] of [[3, 7], [384, 384], [1536, 384], [384, 1536]]) {
      const weights = Float32Array.from({ length: rows * cols }, (_, i) => Math.sin(i) / cols), input = Float32Array.from({ length: cols }, (_, i) => Math.cos(i)), bias = new Float32Array(rows).fill(0.03), a = new Float32Array(rows), b = new Float32Array(rows);
      scalarBackend.linear(weights, input, bias, a); backend.linear(weights, input, bias, b);
      assert.deepEqual(a, b);
    }
    backend.dispose();
    assert.throws(() => backend.linear(new Float32Array(1), new Float32Array(1), undefined, new Float32Array(1)), /disposed/);
  });

  test(`full role engines using WASM ${variant} match every golden case`, async () => {
    const bytes = await bytesFor(variant);
    const a = new Phone1Engine(await loadShard('phone1'), await instantiateWasmBackend(bytes, 'phone1'));
    const b = new Phone2Engine(await loadShard('phone2'), await instantiateWasmBackend(bytes, 'phone2'));
    const cases = [];
    for (const entry of golden.cases) {
      a.reset(); b.reset(); let next = 0, activationError = 0, logitError = 0;
      const samples = new Map(entry.samples.map(s => [s.position, s]));
      for (let position = 0; position < entry.prompt_bytes.length; position++) {
        const hidden = a.step(entry.prompt_bytes[position]), result = b.step(hidden, position, true);
        next = result.byte;
        if (samples.has(position)) {
          const sample = samples.get(position);
          activationError = Math.max(activationError, closeArray(hidden, sample.phone1_activation));
          logitError = Math.max(logitError, closeArray(result.logits, sample.logits));
          assert.equal(result.byte, sample.greedy_byte);
        }
      }
      const generated = [next];
      while (generated.length < entry.max_new_bytes && a.position < 512) { next = b.step(a.step(next)).byte; generated.push(next); }
      assert.deepEqual(generated, entry.generated_bytes);
      if (a.position === 512) {
        assert.throws(() => a.step(next), /Position/);
        assert.throws(() => b.step(new Float32Array(384)), /Position/);
        assert.deepEqual(a.stats.cacheLengths, [512, 512, 512]);
      }
      cases.push({ case: entry.name, maxAbsActivationError: activationError, maxAbsLogitError: logitError, generatedBytes: generated });
    }
    await writeFile(new URL(`artifacts/reports/milestone2-wasm-${variant}-golden.json`, root), JSON.stringify({ backend: a.stats.backend, cases }, null, 2) + '\n');
    a.dispose(); b.dispose();
  });
}

test('unsupported SIMD and missing kernels fall back explicitly to scalar implementations', async () => {
  const requests = [];
  const selected = await selectBackend('phone1', 'auto', 'https://local.test/wasm/', async url => {
    requests.push(String(url));
    return String(url).includes('simd') ? new Response(new Uint8Array([1, 2, 3])) : new Response(await bytesFor('scalar'));
  });
  assert.equal(selected.backend.name, 'wasm-scalar'); assert.equal(selected.fallbackReasons.length, 1); assert.equal(requests.length, 2);
  selected.backend.dispose();
  const fallback = await selectBackend('phone2', 'auto', 'https://local.test/wasm/', async () => new Response('', { status: 404 }));
  assert.equal(fallback.backend.name, 'typescript-scalar'); assert.equal(fallback.fallbackReasons.length, 2);
});
