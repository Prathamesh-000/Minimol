import test from 'node:test';
import assert from 'node:assert/strict';
import { matVec, matMul } from '../../dist/inference/matrixMultiply.js';
import { erf, gelu } from '../../dist/inference/gelu.js';
import { layerNorm } from '../../dist/inference/layerNorm.js';
import { embedByte } from '../../dist/inference/embeddings.js';
import { causalAttention } from '../../dist/inference/attention.js';
import { RoleKVCache } from '../../dist/inference/kvCache.js';
import { addResidualInPlace } from '../../dist/inference/feedForward.js';
import { greedyByte } from '../../dist/inference/phone2Engine.js';
import { closeArray } from './helpers.mjs';

test('row-major scalar matrix/vector and batched multiplication, bias and tail dimensions', () => {
  const w = Float32Array.from({ length: 35 }, (_, i) => (i - 13) / 9), x = new Float32Array([1, 2, 3, -4, -5, 6, 7]);
  const bias = new Float32Array([1, -1, 0, 3, 5]), out = new Float32Array(5);
  matVec(w, x, bias, out);
  const expected = Array.from(bias, (b, row) => b + Array.from(x).reduce((sum, v, col) => sum + v * w[row * 7 + col], 0));
  closeArray(out, expected, 1e-5, 1e-6);
  const batch = new Float32Array([...x, ...x]), result = new Float32Array(10);
  matMul(w, batch, 5, 7, 2, result, bias);
  assert.deepEqual(result, new Float32Array([...out, ...out]));
  assert.throws(() => matVec(w.subarray(1), x, bias, out), /shape/);
});

test('erf is accurate and GELU uses the erf formula, including tails and zero', () => {
  const cases = [[0, 0], [0.1, 0.1124629160182849], [0.5, 0.5204998778130465], [1, 0.8427007929497149], [2, 0.9953222650189527], [3, 0.9999779095030014], [5, 0.9999999999984626], [6, 1]];
  for (const [x, expected] of cases) {
    assert.ok(Math.abs(erf(x) - expected) < 2e-15, `${x}: ${erf(x)} vs ${expected}`);
    assert.ok(Math.abs(erf(-x) + expected) < 2e-15);
  }
  assert.equal(gelu(1), Math.fround(0.8413447460685429));
  assert.equal(gelu(-1), Math.fround(-0.15865525393145707));
  assert.equal(gelu(12), 12);
  assert.equal(Math.abs(gelu(-12)), 0);
});

test('LayerNorm uses population variance, epsilon and affine parameters', () => {
  const input = new Float32Array([1, 2, 3, 4]), weight = new Float32Array([1, 2, 3, 4]), bias = new Float32Array([1, 0, -1, 2]), out = new Float32Array(4);
  layerNorm(input, weight, bias, out);
  closeArray(out, Array.from(input, (v, i) => (v - 2.5) / Math.sqrt(1.25 + 1e-5) * weight[i] + bias[i]), 1e-6, 1e-6);
  layerNorm(new Float32Array([7, 7, 7, 7]), weight, bias, out);
  assert.deepEqual(out, bias);
});

test('byte/position embedding lookup and residual addition', () => {
  const tokens = new Float32Array(256 * 384), positions = new Float32Array(512 * 384), out = new Float32Array(384);
  tokens.fill(2, 255 * 384); positions.fill(3, 511 * 384);
  embedByte(255, 511, tokens, positions, out);
  assert.ok(out.every(v => v === 5));
  addResidualInPlace(out, new Float32Array(384).fill(-2));
  assert.ok(out.every(v => v === 3));
  assert.throws(() => embedByte(256, 0, tokens, positions, out), /Byte/);
  assert.throws(() => embedByte(1, 512, tokens, positions, out), /Position/);
});

test('multi-head causal attention agrees with an independent all-history calculation', () => {
  const cache = new RoleKVCache('phone1'), layer = cache.layers[0], out = new Float32Array(384), scores = new Float32Array(512), history = [];
  // Future storage must never be read, even when it contains invalid data.
  layer.keys.fill(NaN); layer.values.fill(NaN);
  for (let t = 0; t < 5; t++) {
    const qkv = Float32Array.from({ length: 1152 }, (_, i) => Math.sin(i * 0.07 + t));
    history.push(qkv); causalAttention(qkv, layer, t, out, scores);
    const expected = new Float32Array(384);
    for (let h = 0; h < 6; h++) {
      const raw = history.map(v => { let sum = 0; for (let d = 0; d < 64; d++) sum += qkv[h * 64 + d] * v[384 + h * 64 + d]; return sum / 8; });
      const maximum = Math.max(...raw), e = raw.map(v => Math.exp(v - maximum)), total = e.reduce((a, b) => a + b, 0);
      for (let d = 0; d < 64; d++) for (let p = 0; p <= t; p++) expected[h * 64 + d] += e[p] / total * history[p][768 + h * 64 + d];
    }
    closeArray(out, expected, 2e-6, 2e-6);
  }
  assert.equal(cache.byteLength, 4718592);
  assert.deepEqual(cache.layers.map(l => l.length), [5, 0, 0]);
  assert.throws(() => layer.append(history[0], 4), /next sequential/);
  cache.reset();
  assert.ok(cache.layers.every(l => l.length === 0 && l.keys.every(v => v === 0) && l.values.every(v => v === 0)));
});

test('attention softmax remains finite for large scores', () => {
  const cache = new RoleKVCache('phone2'), out = new Float32Array(384), scores = new Float32Array(512), qkv = new Float32Array(1152).fill(100);
  qkv.fill(2, 768);
  causalAttention(qkv, cache.layers[0], 0, out, scores);
  assert.ok(out.every(v => v === 2));
});

test('greedy selection resolves ties to the lowest byte and rejects invalid logits', () => {
  const logits = new Float32Array(256); logits[17] = logits[98] = 1;
  assert.equal(greedyByte(logits), 17);
  logits[0] = NaN; assert.throws(() => greedyByte(logits), /Nonfinite/);
});
