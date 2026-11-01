import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Phone1Engine } from '../../dist/inference/phone1Engine.js';
import { Phone2Engine } from '../../dist/inference/phone2Engine.js';
import { generate, promptBytes } from '../../dist/inference/generation.js';
import { MODEL_CONFIG } from '../../dist/inference/modelConfig.js';
import { golden, root, loadShard, closeArray } from './helpers.mjs';

const shard1 = await loadShard('phone1'), shard2 = await loadShard('phone2');
function pair() { return [new Phone1Engine(shard1), new Phone2Engine(shard2)]; }
function localTransport(a, b) { return { async reset() { a.reset(); b.reset(); }, async step(byte, position) { return b.step(a.step(byte, position), position).byte; } }; }

test('TypeScript model contract exactly matches the unchanged Python configuration', async () => {
  assert.deepEqual(MODEL_CONFIG, JSON.parse(await readFile(new URL('model/model_config.json', root), 'utf8')));
});

test('each engine can own only its assigned shard and exactly three layers', () => {
  const [a, b] = pair();
  assert.equal(a.parameterCount, 5618304); assert.equal(b.parameterCount, 5422464);
  assert.deepEqual(a.layerIds, [0, 1, 2]); assert.deepEqual(b.layerIds, [3, 4, 5]);
  assert.equal(a.stats.kvBytes, 4718592); assert.equal(b.stats.kvBytes, 4718592);
  assert.throws(() => new Phone1Engine(shard2), /verified phone1/);
  assert.throws(() => new Phone2Engine(shard1), /verified phone2/);
  assert.throws(() => new Phone1Engine({ ...shard1 }), /verified phone1/);
  assert.throws(() => shard1.tensor('blocks.3.ln1.weight'), /does not own/);
  assert.throws(() => shard2.tensor('token_embedding.weight'), /does not own/);
});

test('incremental prefill and generation match all seven canonical golden cases', async () => {
  const [a, b] = pair(), results = [];
  for (const entry of golden.cases) {
    a.reset(); b.reset();
    const samples = new Map(entry.samples.map(s => [s.position, s]));
    let next = -1, activationError = 0, logitError = 0;
    for (let p = 0; p < entry.prompt_bytes.length; p++) {
      const activation = a.step(entry.prompt_bytes[p], p), output = b.step(activation, p, true);
      next = output.byte;
      if (samples.has(p)) {
        const sample = samples.get(p);
        activationError = Math.max(activationError, closeArray(activation, sample.phone1_activation));
        logitError = Math.max(logitError, closeArray(output.logits, sample.logits));
        assert.equal(next, sample.greedy_byte, `${entry.name} at ${p}`);
      }
    }
    const generated = [next];
    while (generated.length < entry.max_new_bytes && a.position < 512) {
      next = b.step(a.step(next)).byte; generated.push(next);
    }
    assert.deepEqual(generated, entry.generated_bytes, entry.name);
    assert.equal(a.position, b.position);
    assert.deepEqual(a.stats.cacheLengths, [a.position, a.position, a.position]);
    assert.deepEqual(b.stats.cacheLengths, [b.position, b.position, b.position]);
    assert.equal(a.stats.layerEvaluations, a.position * 3);
    assert.equal(b.stats.layerEvaluations, b.position * 3);
    results.push({ case: entry.name, processedPositions: a.position, maxAbsActivationError: activationError, maxAbsLogitError: logitError, greedyMatch: true, generatedBytes: generated });
  }
  await mkdir(new URL('artifacts/reports/', root), { recursive: true });
  await writeFile(new URL('artifacts/reports/milestone2-scalar-golden.json', root), JSON.stringify({ backend: a.stats.backend, tolerance: golden.tolerance, cases: results }, null, 2) + '\n');
});

test('KV appends preserve previous entries and reset produces a fresh deterministic session', () => {
  const [a, b] = pair();
  const first = a.step(65), firstOutput = b.step(first, 0, true);
  const aCache = a.cacheSnapshot(), bCache = b.cacheSnapshot();
  b.step(a.step(66));
  for (const [engine, before] of [[a, aCache], [b, bCache]]) {
    const after = engine.cacheSnapshot();
    for (let i = 0; i < 3; i++) {
      assert.equal(after[i].length, 2);
      assert.deepEqual(after[i].keys.subarray(0, 384), before[i].keys);
      assert.deepEqual(after[i].values.subarray(0, 384), before[i].values);
    }
    engine.reset(); assert.deepEqual(engine.stats.cacheLengths, [0, 0, 0]);
  }
  const again = a.step(65), output = b.step(again, 0, true);
  assert.deepEqual(again, first); assert.deepEqual(output.logits, firstOutput.logits);
  first.fill(NaN); assert.ok(again.every(Number.isFinite));
});

test('bad bytes, activations and positions do not advance cache state; context overflow is rejected', () => {
  const [a, b] = pair();
  for (const byte of [-1, 256, 1.5, NaN]) assert.throws(() => a.step(byte), /Byte/);
  assert.throws(() => a.step(1, 1), /Expected position/);
  assert.throws(() => a.step(1, 512), /Position/);
  for (const activation of [new Float32Array(383), new Float64Array(384), new Float32Array(384).fill(NaN)]) assert.throws(() => b.step(activation));
  assert.equal(a.position, 0); assert.equal(b.position, 0);
  assert.deepEqual(a.stats.cacheLengths, [0, 0, 0]); assert.deepEqual(b.stats.cacheLengths, [0, 0, 0]);
  a.dispose(); assert.throws(() => a.step(1), /disposed/);
});

test('generation coordinator prefill, UTF-8, feedback, zero output, abort and failure reset', async () => {
  const [a, b] = pair(), transport = localTransport(a, b);
  const entry = golden.cases.find(c => c.name === 'utf8_hindi_emoji');
  const result = await generate(transport, 'नमस्ते 🌍', 8);
  assert.deepEqual([...result.generated], entry.generated_bytes);
  assert.equal(result.inputBytes, 23); assert.equal(result.processedPositions, 30);
  const second = await generate(transport, 'नमस्ते 🌍', 8); assert.deepEqual(second, result);
  assert.throws(() => promptBytes(''), /1–512/);
  assert.throws(() => promptBytes('🌍'.repeat(129)), /1–512/);
  await assert.rejects(generate(transport, 'a', -1), /nonnegative/);
  const zero = await generate(transport, 'a', 0); assert.equal(zero.processedPositions, 0);
  const controller = new AbortController();
  const stopped = await generate(transport, 'Hi', 8, { signal: controller.signal, onByte() { controller.abort(); } });
  assert.equal(stopped.stopReason, 'aborted'); assert.equal(stopped.generated.length, 1);
  assert.equal(a.position, 0); assert.equal(b.position, 0);
  let resets = 0;
  await assert.rejects(generate({ async reset() { resets++; }, async step() { throw new Error('peer failed'); } }, 'Hi', 1), /peer failed/);
  assert.equal(resets, 2);
});

test('a full context allows its last prediction but never feeds it into position 512', async () => {
  let calls = 0;
  const result = await generate({ async reset() { calls = 0; }, async step(_, position) { assert.equal(position, calls++); return 0; } }, new Uint8Array(512), 8);
  assert.equal(calls, 512); assert.equal(result.stopReason, 'context'); assert.equal(result.generated.length, 1);
});
