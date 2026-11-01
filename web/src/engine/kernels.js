// Owned by Member 2. Baseline correct CPU kernels; optimize only AFTER parity passes.
export const D = 384;
export const FF = 1536;
export const H = 6;
export const HD = 64;
export const CTX = 512;

export function layerNorm(x, weight, bias, eps = 1e-5) {
  const n = x.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += x[i];
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const z = x[i] - mean;
    variance += z * z;
  }
  const scale = 1 / Math.sqrt(variance / n + eps);
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) result[i] = (x[i] - mean) * scale * weight[i] + bias[i];
  return result;
}

export function linear(x, weights, bias, nOut) {
  const nIn = x.length;
  if (weights.length !== nIn * nOut) throw new Error('Invalid linear weight shape');
  if (bias && bias.length !== nOut) throw new Error('Invalid linear bias shape');
  const out = new Float32Array(nOut);
  for (let r = 0; r < nOut; r++) {
    let acc = bias ? bias[r] : 0;
    const base = r * nIn;
    for (let c = 0; c < nIn; c++) acc += weights[base + c] * x[c];
    out[r] = acc;
  }
  return out;
}

export function geluTanhInPlace(x) {
  const k = Math.sqrt(2 / Math.PI);
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    x[i] = 0.5 * a * (1 + Math.tanh(k * (a + 0.044715 * a * a * a)));
  }
  return x;
}

export function addInPlace(a, b) {
  if (a.length !== b.length) throw new Error('Residual shape mismatch');
  for (let i = 0; i < a.length; i++) a[i] += b[i];
  return a;
}

export function argmax(x) {
  if (!x.length) throw new Error('Empty logits');
  let best = 0;
  for (let i = 1; i < x.length; i++) if (x[i] > x[best]) best = i;
  return best;
}

// Single-token attention with a *per-layer* K/V cache, Float32, causal by construction.
export function attentionStep(qkv, cache, position) {
  if (position !== cache.used) throw new Error(`KV position ${position} != ${cache.used}`);
  if (qkv.length !== D * 3) throw new Error('Invalid QKV shape');
  const begin = position * D;
  cache.keys.set(qkv.subarray(D, 2 * D), begin);
  cache.values.set(qkv.subarray(2 * D, 3 * D), begin);
  cache.used++;
  const out = new Float32Array(D);
  const scores = new Float32Array(position + 1);
  for (let h = 0; h < H; h++) {
    const hOffset = h * HD;
    let max = -Infinity;
    for (let t = 0; t <= position; t++) {
      let dot = 0;
      const kOffset = t * D + hOffset;
      for (let j = 0; j < HD; j++) dot += qkv[hOffset + j] * cache.keys[kOffset + j];
      const score = dot / Math.sqrt(HD);
      scores[t] = score;
      if (score > max) max = score;
    }
    let total = 0;
    for (let t = 0; t <= position; t++) {
      scores[t] = Math.exp(scores[t] - max);
      total += scores[t];
    }
    for (let t = 0; t <= position; t++) {
      const p = scores[t] / total;
      const offset = t * D + hOffset;
      for (let j = 0; j < HD; j++) out[hOffset + j] += p * cache.values[offset + j];
    }
  }
  return out;
}

export function createKV() {
  return {keys: new Float32Array(CTX * D), values: new Float32Array(CTX * D), used: 0};
}
