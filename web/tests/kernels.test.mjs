import test from 'node:test';
import assert from 'node:assert/strict';
import {layerNorm, linear, argmax, geluTanhInPlace} from '../src/engine/kernels.js';
import {packActivation, unpackActivation, FRAME_BYTES} from '../src/network/protocol.js';

test('linear is row-major, bias applied once', () => {
  assert.deepEqual(Array.from(linear(new Float32Array([2, 3]), new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6]), 2)), [13, 24]);
});

test('norm and GELU finite', () => {
  const x = layerNorm(new Float32Array([1, 2, 3]), new Float32Array([1, 1, 1]), new Float32Array([0, 0, 0]));
  assert(Math.abs(x[0] + x[2]) < 1e-6);
  assert.equal(argmax(new Float32Array([1, 5, 5, -1])), 1);
  assert(geluTanhInPlace(new Float32Array([-1, 0, 1])).every(Number.isFinite));
});

test('activation frame round trip', () => {
  const x = Float32Array.from({length: 384}, (_, i) => i / 256);
  const raw = packActivation({runSequence: 99, position: 4, sample: true, activation: x});
  assert.equal(raw.byteLength, FRAME_BYTES);
  const decoded = unpackActivation(raw);
  assert.equal(decoded.position, 4);
  assert.equal(decoded.runSequence, 99);
  assert.equal(decoded.sample, true);
  assert.deepEqual(Array.from(decoded.activation), Array.from(x));
});

test('corrupted activation header rejected', () => {
  const x = new Float32Array(384);
  const raw = packActivation({runSequence: 1, position: 0, sample: false, activation: x});
  new DataView(raw).setUint32(12, 100, true);
  assert.throws(() => unpackActivation(raw));
});
