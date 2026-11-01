import test from 'node:test';
import assert from 'node:assert/strict';
import { Phone1Engine } from '../../dist/inference/phone1Engine.js';
import { Phone2Engine } from '../../dist/inference/phone2Engine.js';
import { scalarBackend } from '../../dist/inference/matrixMultiply.js';
import { createWorkerRuntime } from '../../dist/workers/workerRuntime.js';
import { loadShard } from './helpers.mjs';

test('a computation failure poisons the partial cache until an explicit reset', async () => {
  let calls = 0, fail = true;
  const backend = { name: 'test-failure-injection', linear(...args) {
    if (++calls === 6 && fail) throw new Error('injected compute failure');
    scalarBackend.linear(...args);
  } };
  const engine = new Phone1Engine(await loadShard('phone1'), backend);
  assert.throws(() => engine.step(65), /injected/);
  assert.equal(engine.stats.failed, true);
  assert.throws(() => engine.step(65), /requires reset/);
  fail = false; engine.reset();
  assert.deepEqual(engine.stats.cacheLengths, [0, 0, 0]);
  assert.deepEqual(engine.step(65), new Phone1Engine(await loadShard('phone1')).step(65));
});

test('default Phone 2 output contains only byte and position; debug logits are explicit', async () => {
  const a = new Phone1Engine(await loadShard('phone1')), b = new Phone2Engine(await loadShard('phone2'));
  const output = b.step(a.step(65));
  assert.deepEqual(Object.keys(output).sort(), ['byte', 'position']);
});

test('worker rejects malformed and duplicate requests without advancing the engine', async () => {
  const handle = createWorkerRuntime('phone1', async () => ({ shard: await loadShard('phone1'), backend: scalarBackend, fallbackReasons: [] }));
  assert.equal((await handle(null)).reply.ok, false);
  assert.equal((await handle({ id: 0, type: 'load' })).reply.ok, true);
  assert.match((await handle({ id: 0, type: 'step', byte: 65, position: 0 })).reply.error, /duplicate/);
  assert.equal((await handle({ id: 1, type: 'step', byte: 65 })).reply.ok, false);
  assert.equal((await handle({ id: 2, type: 'step', byte: 65, position: 0 })).reply.ok, true);
  assert.equal((await handle({ id: 3, type: 'stats' })).reply.result.position, 1);
});
