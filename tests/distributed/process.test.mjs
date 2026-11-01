import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { processPair } from './process-harness.mjs';
import { golden, root, closeArray } from '../inference/helpers.mjs';
import { MessageType as T, decodeMessage, encodeMessage } from '../../dist/networking/protocol.js';

test('two isolated Node processes exchange production binary frames and match every golden case', { timeout: 60000 }, async () => {
  const pair = await processPair();
  try {
    assert.notEqual(pair.boots[0].pid, pair.boots[1].pid);
    assert.ok(pair.boots.every(b => b.pid !== process.pid));
    assert.deepEqual(pair.boots.map(b => b.parameterCount), [5618304, 5422464]);
    assert.ok(pair.boots[0].tensorNames.every(n => !/^blocks\.[345]\.|^final_ln|^lm_head/.test(n)));
    assert.ok(pair.boots[1].tensorNames.every(n => !/^blocks\.[012]\.|embedding/.test(n)));
    assert.equal(new Set([...pair.boots[0].tensorNames, ...pair.boots[1].tensorNames]).size, 77);
    await pair.ready(); const cases = [];
    for (const entry of golden.cases) {
      const begin = pair.frames.length;
      const result = await pair.command(0, 'generate', { prompt: entry.prompt_bytes, count: entry.max_new_bytes, samplePositions: entry.samples.map(s => s.position) });
      assert.deepEqual([...result.generated], entry.generated_bytes);
      let activationError = 0, logitError = 0;
      for (const sample of entry.samples) {
        const actual = result.observed.find(s => s.position === sample.position);
        activationError = Math.max(activationError, closeArray(actual.activation, sample.phone1_activation));
        logitError = Math.max(logitError, closeArray(actual.logits, sample.logits)); assert.equal(actual.byte, sample.greedy_byte);
      }
      const a = result.stats, b = await pair.command(1, 'stats'), frames = pair.frames.slice(begin);
      const activations = frames.filter(f => f.type === T.ACTIVATION), responses = frames.filter(f => f.type === T.NEXT_BYTE);
      assert.equal(activations.length, result.processedPositions); assert.equal(responses.length, activations.length);
      for (const stats of [a, b]) {
        assert.equal(stats.engine.position, result.processedPositions);
        assert.deepEqual(stats.engine.cacheLengths, Array(3).fill(result.processedPositions));
        assert.equal(stats.trace.length, result.processedPositions);
        stats.trace.forEach((t, position) => {
          assert.equal(t.position, position); assert.equal(t.layerEvaluations, 3);
          assert.deepEqual(t.layerIds, stats.role === 'phone1' ? [0, 1, 2] : [3, 4, 5]);
          assert.deepEqual(t.cacheBefore, [position, position, position]); assert.deepEqual(t.cacheAfter, [position + 1, position + 1, position + 1]);
          assert.equal(t.requestId, activations[position].requestId);
        });
      }
      activations.forEach((frame, i) => { assert.equal(frame.bytes, 1576); assert.equal(responses[i].requestId, frame.requestId); assert.equal(responses[i].position, frame.position); });
      cases.push({ name: entry.name, positions: result.processedPositions, maxActivationError: activationError, maxLogitError: logitError, generatedBytes: [...result.generated], runtimeATrace: a.trace, runtimeBTrace: b.trace });
    }
    await mkdir(new URL('artifacts/reports/', root), { recursive: true });
    await writeFile(new URL('artifacts/reports/milestone3-processes.json', root), JSON.stringify({ isolation: pair.boots, cases, frames: pair.frames }, null, 2) + '\n');
  } finally { await pair.close(); }
});

test('two-process timeout invalidates both caches and does not retry activations', async () => {
  const pair = await processPair(150);
  try {
    await pair.ready(); pair.setFault((role, frame) => role === 'phone2' && decodeMessage(frame).type === T.NEXT_BYTE ? null : frame);
    await assert.rejects(pair.command(0, 'generate', { prompt: [65], count: 1, samplePositions: [] }), /timed out/);
    const [a, b] = await Promise.all([pair.command(0, 'stats'), pair.command(1, 'stats')]);
    assert.equal(a.state, 'FAILED'); assert.equal(b.state, 'FAILED');
    assert.deepEqual(a.engine.cacheLengths, [0, 0, 0]); assert.deepEqual(b.engine.cacheLengths, [0, 0, 0]);
    assert.equal(pair.frames.filter(f => f.type === T.ACTIVATION).length, 1);
  } finally { await pair.close(); }
});

test('process interruption rejects in-flight generation; incompatible HELLO rejects before inference', async () => {
  const pair = await processPair();
  try {
    await pair.ready(); pair.setFault((role, frame) => {
      if (role === 'phone1' && decodeMessage(frame).type === T.ACTIVATION) { pair.children[1].kill(); return null; } return frame;
    });
    await assert.rejects(pair.command(0, 'generate', { prompt: [65], count: 1, samplePositions: [] }), /closed|exited/);
    assert.deepEqual((await pair.command(0, 'stats')).engine.cacheLengths, [0, 0, 0]);
  } finally { await pair.close(); }
  const wrong = await processPair();
  try {
    wrong.setFault((role, frame) => { const m = decodeMessage(frame); if (role === 'phone1' && m.type === T.HELLO) { m.hello.configHash = '0'.repeat(64); return encodeMessage(m); } return frame; });
    const replies = await Promise.allSettled([wrong.command(0, 'start'), wrong.command(1, 'start')]);
    assert.ok(replies.every(r => r.status === 'rejected'));
    assert.equal((await wrong.command(1, 'stats')).localSteps, 0);
  } finally { await wrong.close(); }
});
