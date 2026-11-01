import test from 'node:test';
import assert from 'node:assert/strict';
import { Phone1Engine } from '../../dist/inference/phone1Engine.js';
import { Phone2Engine } from '../../dist/inference/phone2Engine.js';
import { DistributedRuntime } from '../../dist/distributed/runtime.js';
import { DistributedCoordinator } from '../../dist/distributed/coordinator.js';
import { MessageType as T, decodeMessage, encodeMessage } from '../../dist/networking/protocol.js';
import { loadShard, manifest, golden } from '../inference/helpers.mjs';
import { memoryLink } from './memory-link.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function pair(options = {}) {
  const link = memoryLink();
  const a = new DistributedRuntime(new Phone1Engine(await loadShard('phone1')), link[0], manifest, options);
  const b = new DistributedRuntime(new Phone2Engine(await loadShard('phone2')), link[1], manifest, options);
  return { a, b, link, async ready() { await Promise.all([a.start(), b.start()]); }, close() { a.close(); b.close(); } };
}

test('HELLO/READY gates generation, START resets both caches, and STOP is acknowledged', async () => {
  const p = await pair();
  try {
    await p.ready(); assert.equal(p.a.state, 'READY'); assert.equal(p.b.state, 'READY');
    await assert.rejects(p.a.step(65, 0), /state/);
    assert.equal(p.a.stats.engine.position, 0); await p.a.begin();
    const step = await p.a.step(65, 0); assert.equal(typeof step.byte, 'number'); assert.equal(step.logits, undefined);
    assert.equal(p.b.stats.engine.position, 1); assert.ok(await p.a.ping() >= 0);
    await p.a.stop(); assert.equal(p.a.state, 'READY'); assert.equal(p.b.state, 'READY');
    assert.deepEqual(p.a.stats.engine.cacheLengths, [0, 0, 0]); assert.deepEqual(p.b.stats.engine.cacheLengths, [0, 0, 0]);
    await p.a.begin(); assert.equal(p.a.stats.generation, 2); assert.equal((await p.a.step(65, 0)).byte, step.byte);
  } finally { p.close(); }
});

test('coordinator reuses the canonical prefill/feedback semantics and rejects concurrent runs', async () => {
  const p = await pair({ allowDebug: true });
  try {
    await p.ready(); const coordinator = new DistributedCoordinator(p.a), steps = [];
    const run = coordinator.generate('Hello', 8, { debug: true, onStep: step => steps.push(step) });
    await assert.rejects(coordinator.generate('Hello', 8), /already running/);
    const result = await run;
    assert.deepEqual([...result.generated], golden.cases[0].generated_bytes); assert.equal(steps.length, 12);
    assert.equal(p.a.stats.localLayerEvaluations, 36); assert.equal(p.b.stats.localLayerEvaluations, 36);
    const again = await coordinator.generate('Hello', 8); assert.deepEqual(again.generated, result.generated);
    await assert.rejects(coordinator.generate('', 1), /1–512/);
  } finally { p.close(); }
});

for (const field of ['role', 'modelId', 'configHash', 'shardHash', 'hidden', 'vocabulary', 'context']) {
  test(`handshake rejects incompatible ${field} before any inference`, async () => {
    const p = await pair({ timeoutMs: 500 });
    p.link[0].mutate = frame => {
      const m = decodeMessage(frame);
      if (m.type === T.HELLO) {
        m.hello[field] = field === 'role' ? 'phone2' : field === 'modelId' ? 'other-model' : ['configHash', 'shardHash'].includes(field) ? '0'.repeat(64) : m.hello[field] + 1;
        return encodeMessage(m);
      }
      return frame;
    };
    const results = await Promise.allSettled([p.a.start(), p.b.start()]);
    assert.ok(results.every(r => r.status === 'rejected')); assert.equal(p.a.stats.localSteps, 0); assert.equal(p.b.stats.localSteps, 0); p.close();
  });
}

test('debug logits require bilateral negotiation', async () => {
  const p = await pair();
  try { await p.ready(); await p.a.begin(); await assert.rejects(p.a.step(1, 0, true), /not negotiated/); assert.equal(p.a.stats.localSteps, 0); }
  finally { p.close(); }
});

for (const fault of ['request', 'position', 'generation', 'connection', 'type', 'duplicate']) {
  test(`uncorrelated ${fault} responses fail closed and clear both caches`, async () => {
    const p = await pair(); await p.ready(); await p.a.begin();
    p.link[1].mutate = frame => {
      const m = decodeMessage(frame);
      if (m.type === T.NEXT_BYTE) {
        if (fault === 'request') m.requestId++;
        if (fault === 'position') m.position++;
        if (fault === 'generation') m.generation++;
        if (fault === 'connection') m.connectionId = 'f'.repeat(32);
        if (fault === 'type') { m.type = T.ACTIVATION; m.activation = new Float32Array(384); }
        if (fault === 'duplicate') queueMicrotask(() => p.link[0].events?.message(frame.slice(0)));
        return encodeMessage(m);
      }
      return frame;
    };
    if (fault === 'duplicate') await p.a.step(65, 0).catch(() => {}); else await assert.rejects(p.a.step(65, 0));
    await tick(); assert.equal(p.a.state, 'FAILED'); assert.equal(p.b.state, 'FAILED');
    assert.equal(p.a.stats.pendingRequests, 0); assert.deepEqual(p.a.stats.engine.cacheLengths, [0, 0, 0]); assert.deepEqual(p.b.stats.engine.cacheLengths, [0, 0, 0]); p.close();
  });
}

test('missing response times out without retrying a cache-mutating activation', async () => {
  const p = await pair({ timeoutMs: 40 }); await p.ready(); await p.a.begin();
  p.link[1].mutate = frame => decodeMessage(frame).type === T.NEXT_BYTE ? null : frame;
  await assert.rejects(p.a.step(65, 0), /timed out/); await tick();
  assert.equal(p.a.stats.localSteps, 1); assert.equal(p.b.stats.localSteps, 1);
  assert.equal(p.link[0].frames.filter(f => decodeMessage(f).type === T.ACTIVATION).length, 1);
  assert.equal(p.a.stats.sendQueuedBytes, 0); assert.deepEqual(p.b.stats.engine.cacheLengths, [0, 0, 0]); p.close();
});

test('handshake timeout, abrupt close, in-flight cancellation and fresh connection recovery', async () => {
  const incomplete = await pair({ handshakeTimeoutMs: 30 });
  await assert.rejects(incomplete.a.start(), /timeout/); incomplete.close();
  const p = await pair(); await p.ready(); await p.a.begin();
  p.link[0].mutate = frame => decodeMessage(frame).type === T.ACTIVATION ? null : frame;
  const pending = p.a.step(65, 0); await tick(); p.link[1].close('test interruption');
  await assert.rejects(pending, /closed/); await tick(); assert.equal(p.a.stats.pendingRequests, 0); p.close();
  const cancelled = await pair(); await cancelled.ready();
  const controller = new AbortController(), coordinator = new DistributedCoordinator(cancelled.a);
  cancelled.link[1].mutate = frame => { if (decodeMessage(frame).type === T.NEXT_BYTE) { controller.abort(); return null; } return frame; };
  const result = await coordinator.generate('Hello', 8, { signal: controller.signal });
  assert.equal(result.stopReason, 'aborted'); await tick(); assert.equal(cancelled.b.state, 'FAILED'); cancelled.close();
  const fresh = await pair(); await fresh.ready();
  const output = await new DistributedCoordinator(fresh.a).generate('Hello', 8);
  assert.deepEqual([...output.generated], golden.cases[0].generated_bytes); fresh.close();
});
