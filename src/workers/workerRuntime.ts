import { assertRole, type Role } from '../inference/modelConfig.js';
import { Phone1Engine } from '../inference/phone1Engine.js';
import { Phone2Engine } from '../inference/phone2Engine.js';
import { type VerifiedShard } from '../inference/weightLoader.js';
import { type LinearBackend } from '../inference/matrixMultiply.js';
import { encodeActivation, decodeActivation } from '../inference/tensor.js';

export interface WorkerLoadResult { shard: VerifiedShard; backend: LinearBackend; fallbackReasons: string[] }
export type WorkerLoader = (request: Record<string, unknown>) => Promise<WorkerLoadResult>;
export interface WorkerReply { id: number; ok: boolean; result?: unknown; error?: string }

/** Worker role is fixed by its creator, never changed by incoming requests. */
export function createWorkerRuntime(role: Role, loader: WorkerLoader) {
  assertRole(role);
  let engine: Phone1Engine | Phone2Engine | undefined, attemptedLoad = false, lastId = -1;
  return async (value: unknown): Promise<{ reply: WorkerReply; transfer: Transferable[] }> => {
    const request = value as Record<string, unknown> | null;
    const id = request && Number.isSafeInteger(request.id) ? request.id as number : -1;
    try {
      if (!request || id < 0 || id <= lastId || typeof request.type !== 'string') throw new Error('Invalid or duplicate worker request');
      lastId = id;
      if (request.role !== undefined && request.role !== role) throw new Error('Worker role cannot change');
      let result: unknown;
      const transfer: Transferable[] = [];
      if (request.type === 'load') {
        if (attemptedLoad) throw new Error('Worker load already attempted; create a new worker to retry');
        attemptedLoad = true;
        const loaded = await loader(request);
        engine = role === 'phone1' ? new Phone1Engine(loaded.shard, loaded.backend) : new Phone2Engine(loaded.shard, loaded.backend);
        result = { ...engine.stats, parameterCount: engine.parameterCount, shardHash: engine.shardHash, fallbackReasons: loaded.fallbackReasons };
      } else {
        if (!engine) throw new Error('Worker model is not ready');
        if (request.type === 'reset') { engine.reset(); result = engine.stats; }
        else if (request.type === 'stats') result = engine.stats;
        else if (request.type === 'dispose') { engine.dispose(); result = engine.stats; }
        else if (request.type === 'step') {
          if (!Number.isInteger(request.position)) throw new Error('Step position is required');
          const position = request.position as number, start = performance.now();
          if (engine instanceof Phone1Engine) {
            if (typeof request.byte !== 'number' || request.activation !== undefined) throw new Error('Phone 1 requires a byte');
            const activation = encodeActivation(engine.step(request.byte, position));
            result = { activation, position, computeMs: performance.now() - start }; transfer.push(activation);
          } else {
            if (request.byte !== undefined) throw new Error('Phone 2 requires an activation');
            const output = engine.step(decodeActivation(request.activation as ArrayBuffer), position, request.debug === true);
            result = { ...output, computeMs: performance.now() - start };
            if (output.logits) transfer.push(output.logits.buffer);
          }
        } else throw new Error('Unknown worker request type');
      }
      return { reply: { id, ok: true, result }, transfer };
    } catch (error) {
      return { reply: { id, ok: false, error: error instanceof Error ? error.message : String(error) }, transfer: [] };
    }
  };
}
