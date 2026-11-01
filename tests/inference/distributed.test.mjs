import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, golden, closeArray } from './helpers.mjs';
import { decodeActivation, encodeActivation } from '../../dist/inference/tensor.js';
import { generate } from '../../dist/inference/generation.js';

function client(worker) {
  let id = 0;
  const pending = new Map();
  worker.on('message', reply => {
    const promise = pending.get(reply.id); pending.delete(reply.id);
    if (reply.ok) promise.resolve(reply.result); else promise.reject(new Error(reply.error));
  });
  worker.on('error', error => { for (const p of pending.values()) p.reject(error); pending.clear(); });
  return (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    const requestId = id++; pending.set(requestId, { resolve, reject });
    worker.postMessage({ id: requestId, type, ...payload }, transfer);
  });
}

test('activation boundary is exactly 1536 little-endian bytes and rejects invalid payloads', () => {
  const values = Float32Array.from({ length: 384 }, (_, i) => i / 3), bytes = encodeActivation(values);
  assert.equal(bytes.byteLength, 1536);
  assert.equal(new DataView(bytes).getFloat32(4, true), values[1]);
  assert.deepEqual(decodeActivation(bytes), values);
  assert.throws(() => decodeActivation(bytes.slice(4)), /1536/);
  new DataView(bytes).setFloat32(0, NaN, true);
  assert.throws(() => decodeActivation(bytes), /Nonfinite/);
});

test('isolated worker runtimes, each with only one shard on disk, match distributed golden outputs', { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'minimol-workers-')), workers = [];
  try {
    const calls = {};
    for (const role of ['phone1', 'phone2']) {
      const directory = join(temporary, role); await mkdir(directory);
      await copyFile(new URL('public/model/manifest.json', root), join(directory, 'manifest.json'));
      await copyFile(new URL(`public/model/${role}.bin`, root), join(directory, `${role}.bin`));
      const worker = new Worker(new URL('./role-worker.mjs', import.meta.url), { workerData: { role, directory } });
      workers.push(worker); calls[role] = client(worker);
      await assert.rejects(calls[role]('step', { byte: 1, position: 0 }), /not ready/);
      const loaded = await calls[role]('load');
      assert.deepEqual(loaded.loadedFiles, ['manifest.json', `${role}.bin`]);
      assert.deepEqual(loaded.layerIds, role === 'phone1' ? [0, 1, 2] : [3, 4, 5]);
      await assert.rejects(calls[role]('load'), /already attempted/);
      await assert.rejects(calls[role]('stats', { role: role === 'phone1' ? 'phone2' : 'phone1' }), /cannot change/);
    }
    const rows = [];
    for (const entry of golden.cases) {
      let transfers = 0, activationBytes = 0, activationError = 0, logitError = 0;
      const samples = new Map(entry.samples.map(s => [s.position, s]));
      const transport = {
        async reset() { await Promise.all([calls.phone1('reset'), calls.phone2('reset')]); },
        async step(byte, position) {
          const a = await calls.phone1('step', { byte, position });
          assert.equal(a.activation.byteLength, 1536); activationBytes += a.activation.byteLength;
          const sample = samples.get(position);
          if (sample) activationError = Math.max(activationError, closeArray(decodeActivation(a.activation), sample.phone1_activation));
          const b = await calls.phone2('step', { activation: a.activation, position, debug: !!sample }, [a.activation]);
          assert.equal(a.activation.byteLength, 0); // Ownership really transferred.
          if (sample) { logitError = Math.max(logitError, closeArray(b.logits, sample.logits)); assert.equal(b.byte, sample.greedy_byte); }
          transfers++; return b.byte;
        },
      };
      const result = await generate(transport, Uint8Array.from(entry.prompt_bytes), entry.max_new_bytes);
      assert.deepEqual([...result.generated], entry.generated_bytes);
      assert.equal(transfers, result.processedPositions);
      for (const role of ['phone1', 'phone2']) {
        const stats = await calls[role]('stats');
        assert.equal(stats.position, transfers); assert.equal(stats.layerEvaluations, transfers * 3);
        assert.deepEqual(stats.cacheLengths, [transfers, transfers, transfers]);
      }
      rows.push({ case: entry.name, requestsPerRole: transfers, activationBytes, maxAbsActivationError: activationError, maxAbsLogitError: logitError, generatedBytesMatch: true });
    }
    await writeFile(new URL('artifacts/reports/milestone2-isolated-workers.json', root), JSON.stringify({ transport: 'worker ArrayBuffer transfer (not WebRTC)', cases: rows }, null, 2) + '\n');
    await assert.rejects(calls.phone2('step', { position: 512, activation: new ArrayBuffer(1536) }), /Position/);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
    await rm(temporary, { recursive: true, force: true });
  }
});
