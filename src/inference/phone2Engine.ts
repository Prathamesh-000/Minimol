import { layerNorm } from './layerNorm.js';
import { type LinearBackend } from './matrixMultiply.js';
import { RoleEngine } from './roleEngine.js';
import { type VerifiedShard } from './weightLoader.js';

export function greedyByte(logits: Float32Array): number {
  if (logits.length !== 256) throw new Error('Expected 256 logits');
  let best = 0;
  for (let i = 0; i < 256; i++) {
    if (!Number.isFinite(logits[i])) throw new Error('Nonfinite logits');
    if (logits[i] > logits[best]) best = i;
  }
  return best;
}
export interface NextByte { byte: number; position: number; logits?: Float32Array }

export class Phone2Engine extends RoleEngine {
  readonly #normWeight: Float32Array;
  readonly #normBias: Float32Array;
  readonly #head: Float32Array;
  readonly #normalized = new Float32Array(384);
  readonly #logits = new Float32Array(256);
  constructor(shard: VerifiedShard, backend?: LinearBackend) {
    super('phone2', shard, backend);
    this.#normWeight = shard.tensor('final_ln.weight');
    this.#normBias = shard.tensor('final_ln.bias');
    this.#head = shard.tensor('lm_head.weight');
  }
  step(activation: Float32Array, position = this.position, debugLogits = false): NextByte {
    this.validatePosition(position);
    if (!(activation instanceof Float32Array) || activation.length !== 384) throw new Error('Expected 384 FP32 activation values');
    for (const value of activation) if (!Number.isFinite(value)) throw new Error('Nonfinite activation');
    try {
      this.hidden.set(activation); this.runBlocks(position);
      layerNorm(this.hidden, this.#normWeight, this.#normBias, this.#normalized);
      this.backend.linear(this.#head, this.#normalized, undefined, this.#logits);
      const byte = greedyByte(this.#logits);
      this.finish();
      return { byte, position, ...(debugLogits ? { logits: this.#logits.slice() } : {}) };
    } catch (error) { return this.fail(error); }
  }
}
