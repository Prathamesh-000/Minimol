import { causalAttention } from './attention.js';
import { addResidualInPlace, feedForward, type FeedForwardWeights } from './feedForward.js';
import { LayerKVCache } from './kvCache.js';
import { layerNorm } from './layerNorm.js';
import { type LinearBackend } from './matrixMultiply.js';
import { type VerifiedShard } from './weightLoader.js';

/** One reusable workspace shared sequentially across the role's three blocks. */
export class BlockWorkspace {
  readonly normalized = new Float32Array(384);
  readonly qkv = new Float32Array(1152);
  readonly attention = new Float32Array(384);
  readonly update = new Float32Array(384);
  readonly expanded = new Float32Array(1536);
  readonly scores = new Float32Array(512);
}

export class TransformerBlock {
  readonly #ln1: [Float32Array, Float32Array];
  readonly #ln2: [Float32Array, Float32Array];
  readonly #qkv: [Float32Array, Float32Array];
  readonly #projection: [Float32Array, Float32Array];
  readonly #mlp: FeedForwardWeights;
  constructor(shard: VerifiedShard, layer: number, readonly cache: LayerKVCache, readonly backend: LinearBackend) {
    const get = (suffix: string) => shard.tensor(`blocks.${layer}.${suffix}`);
    this.#ln1 = [get('ln1.weight'), get('ln1.bias')];
    this.#qkv = [get('attn.qkv.weight'), get('attn.qkv.bias')];
    this.#projection = [get('attn.proj.weight'), get('attn.proj.bias')];
    this.#ln2 = [get('ln2.weight'), get('ln2.bias')];
    this.#mlp = { first: get('mlp.fc1.weight'), firstBias: get('mlp.fc1.bias'), second: get('mlp.fc2.weight'), secondBias: get('mlp.fc2.bias') };
  }
  forwardInPlace(hidden: Float32Array, position: number, scratch: BlockWorkspace): void {
    layerNorm(hidden, ...this.#ln1, scratch.normalized);
    this.backend.linear(this.#qkv[0], scratch.normalized, this.#qkv[1], scratch.qkv);
    causalAttention(scratch.qkv, this.cache, position, scratch.attention, scratch.scores);
    this.backend.linear(this.#projection[0], scratch.attention, this.#projection[1], scratch.update);
    addResidualInPlace(hidden, scratch.update);
    layerNorm(hidden, ...this.#ln2, scratch.normalized);
    feedForward(scratch.normalized, this.#mlp, scratch.expanded, scratch.update, this.backend);
    addResidualInPlace(hidden, scratch.update);
  }
}
