// Owned by Member 2. Stable interface: createEngine, forwardByte, forwardActivation, reset.
import {CTX, D, FF, layerNorm, linear, geluTanhInPlace, addInPlace,
        argmax, attentionStep, createKV} from './kernels.js';

const EXPECTED_FULL = 11_040_768;
const COUNTS = {phone1: 5_618_304, phone2: 5_422_464};

function hex(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer), x => x.toString(16).padStart(2, '0')).join('');
}

async function verifySHA256(buffer, digest) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure HTTPS context required for SHA-256');
  if (hex(await crypto.subtle.digest('SHA-256', buffer)) !== digest) {
    throw new Error('Model shard SHA-256 mismatch');
  }
}

function validateManifest(manifest, role, binary) {
  if (manifest.schemaVersion !== 1 || manifest.spec?.totalParameters !== EXPECTED_FULL) {
    throw new Error('Unexpected model version/count');
  }
  const shard = manifest.shards?.[role];
  if (!shard || binary.byteLength !== shard.byteLength || binary.byteLength !== COUNTS[role] * 4) {
    throw new Error('Invalid model shard byte length');
  }
  const tensorEntries = manifest.tensors.filter(t => t.role === role);
  let total = 0;
  const map = new Map();
  for (const entry of tensorEntries) {
    const count = entry.shape.reduce((a, b) => a * b, 1);
    if (!Number.isInteger(entry.byteOffset) || entry.byteOffset !== total ||
        entry.byteLength !== count * 4 || entry.byteOrder !== 'little' ||
        entry.dtype !== 'float32' || map.has(entry.name)) throw new Error('Bad tensor metadata');
    const data = new Float32Array(binary, entry.byteOffset, count);
    map.set(entry.name, data);
    total += entry.byteLength;
  }
  if (total !== shard.byteLength) throw new Error('Incomplete model shard');
  return map;
}

class Engine {
  constructor(role, tensors) {
    if (!['phone1', 'phone2'].includes(role)) throw new Error('Invalid role');
    this.role = role;
    this.tensors = tensors;
    this.layerIds = role === 'phone1' ? [0, 1, 2] : [3, 4, 5];
    this.reset();
  }
  get(name) {
    const result = this.tensors.get(name);
    if (!result) throw new Error(`Missing tensor: ${name}`);
    return result;
  }
  reset() {
    this.position = 0;
    this.caches = new Map(this.layerIds.map(layer => [layer, createKV()]));
  }
  _validatePosition(position) {
    if (!Number.isInteger(position) || position !== this.position || position < 0 || position >= CTX) {
      throw new Error(`Invalid token position ${position}; expected ${this.position}`);
    }
  }
  _blocks(x, position) {
    for (const id of this.layerIds) {
      const path = `blocks.${id}`;
      const normalized = layerNorm(x, this.get(`${path}.ln1.weight`), this.get(`${path}.ln1.bias`));
      const qkv = linear(normalized, this.get(`${path}.qkv.weight`), this.get(`${path}.qkv.bias`), 3 * D);
      const attended = attentionStep(qkv, this.caches.get(id), position);
      addInPlace(x, linear(attended, this.get(`${path}.proj.weight`), this.get(`${path}.proj.bias`), D));
      const norm2 = layerNorm(x, this.get(`${path}.ln2.weight`), this.get(`${path}.ln2.bias`));
      const ff1 = linear(norm2, this.get(`${path}.fc1.weight`), this.get(`${path}.fc1.bias`), FF);
      const ff2 = linear(geluTanhInPlace(ff1), this.get(`${path}.fc2.weight`), this.get(`${path}.fc2.bias`), D);
      addInPlace(x, ff2);
    }
    this.position++;
    return x;
  }
  async forwardByte({token, position}) {
    if (this.role !== 'phone1') throw new Error('forwardByte is phone1-only');
    if (!Number.isInteger(token) || token < 0 || token > 255) throw new Error('Invalid input byte');
    this._validatePosition(position);
    const embedding = this.get('token_embedding.weight');
    const posEmbedding = this.get('position_embedding.weight');
    const x = new Float32Array(D);
    for (let j = 0; j < D; j++) x[j] = embedding[token * D + j] + posEmbedding[position * D + j];
    return this._blocks(x, position);
  }
  async forwardActivation({activation, position, sample = true}) {
    if (this.role !== 'phone2') throw new Error('forwardActivation is phone2-only');
    if (!(activation instanceof Float32Array) || activation.length !== D ||
        !activation.every(Number.isFinite)) throw new Error('Invalid activation');
    this._validatePosition(position);
    const x = this._blocks(new Float32Array(activation), position);
    if (!sample) return {byte: null};
    const normalized = layerNorm(x, this.get('ln_f.weight'), this.get('ln_f.bias'));
    const logits = linear(normalized, this.get('head.weight'), null, 256);
    return {byte: argmax(logits), logits};
  }
  dispose() { this.reset(); this.tensors.clear(); }
}

export function createEngineFromBuffers({role, manifest, binary}) {
  return new Engine(role, validateManifest(manifest, role, binary));
}

export async function createEngine({role, manifestUrl = '/model/manifest.json'}) {
  const response = await fetch(manifestUrl, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Cannot load manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  const shard = manifest.shards?.[role];
  if (!shard) throw new Error('Invalid role');
  const shardUrl = new URL(shard.file, new URL(manifestUrl, location.href));
  const file = await fetch(shardUrl);
  if (!file.ok) throw new Error(`Cannot load shard: HTTP ${file.status}`);
  const binary = await file.arrayBuffer();
  await verifySHA256(binary, shard.sha256);
  return {engine: createEngineFromBuffers({role, manifest, binary}), modelId: manifest.fullWeights.sha256};
}
