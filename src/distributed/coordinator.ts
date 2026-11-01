import { promptBytes, type GenerationResult } from '../inference/generation.js';
import { DistributedRuntime, type DistributedStep } from './runtime.js';

export interface DistributedGenerationResult extends GenerationResult { generation: number }
/** Lives in Runtime A. It has no access to Runtime B's engine or weights. */
export class DistributedCoordinator {
  #running = false;
  constructor(readonly runtime: DistributedRuntime) {
    if (runtime.role !== 'phone1') throw new Error('Coordinator requires Phone 1');
  }
  async generate(prompt: string | Uint8Array, maxNewBytes: number,
    options: { debug?: boolean; signal?: AbortSignal; onStep?: (step: DistributedStep) => void; onByte?: (byte: number) => void } = {}): Promise<DistributedGenerationResult> {
    const bytes = promptBytes(prompt);
    if (!Number.isInteger(maxNewBytes) || maxNewBytes < 0) throw new Error('maxNewBytes must be a nonnegative integer');
    if (this.#running) throw new Error('A generation is already running');
    this.#running = true;
    const generated: number[] = []; let processedPositions = 0;
    const result = (stopReason: GenerationResult['stopReason']): DistributedGenerationResult => ({ generated: Uint8Array.from(generated), inputBytes: bytes.length,
      processedPositions, stopReason, generation: this.runtime.stats.generation });
    const abort = () => this.runtime.abort();
    try {
      if (options.signal?.aborted) return result('aborted');
      options.signal?.addEventListener('abort', abort, { once: true });
      await this.runtime.begin();
      if (maxNewBytes === 0) { await this.runtime.stop(); return result('length'); }
      const exchange = async (byte: number) => {
        const step = await this.runtime.step(byte, processedPositions, options.debug);
        processedPositions++; options.onStep?.(step); return step.byte;
      };
      let predicted = 0;
      for (const byte of bytes) predicted = await exchange(byte);
      while (generated.length < maxNewBytes) {
        if (options.signal?.aborted) return result('aborted');
        generated.push(predicted); options.onByte?.(predicted);
        if (options.signal?.aborted) return result('aborted');
        if (generated.length === maxNewBytes) return result('length');
        if (processedPositions === 512) return result('context');
        predicted = await exchange(predicted);
      }
      return result('length');
    } catch (error) {
      if (options.signal?.aborted) return result('aborted');
      // Any uncertain local callback/transport outcome invalidates both caches.
      this.runtime.abort(); throw error;
    } finally { options.signal?.removeEventListener('abort', abort); this.#running = false; }
  }
}
