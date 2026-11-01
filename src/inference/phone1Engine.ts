import { embedByte } from './embeddings.js';
import { type LinearBackend } from './matrixMultiply.js';
import { assertByte } from './modelConfig.js';
import { RoleEngine } from './roleEngine.js';
import { type VerifiedShard } from './weightLoader.js';

export class Phone1Engine extends RoleEngine {
  readonly #tokens: Float32Array;
  readonly #positions: Float32Array;
  constructor(shard: VerifiedShard, backend?: LinearBackend) {
    super('phone1', shard, backend);
    this.#tokens = shard.tensor('token_embedding.weight');
    this.#positions = shard.tensor('position_embedding.weight');
  }
  step(byte: number, position = this.position): Float32Array {
    assertByte(byte); this.validatePosition(position);
    try {
      embedByte(byte, position, this.#tokens, this.#positions, this.hidden);
      this.runBlocks(position); this.finish();
      // Output owns its 1,536 bytes and can be transferred without detaching scratch.
      return this.hidden.slice();
    } catch (error) { return this.fail(error); }
  }
}
