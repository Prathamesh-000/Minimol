import { assertPosition } from './modelConfig.js';
import { RoleKVCache } from './kvCache.js';
import { scalarBackend } from './matrixMultiply.js';
import { BlockWorkspace, TransformerBlock } from './transformerBlock.js';
import { requireVerifiedShard } from './weightLoader.js';
/** Internal shared plumbing, with exactly three immutable role-owned layers. */
export class RoleEngine {
    role;
    backend;
    #cache;
    #blocks;
    #workspace = new BlockWorkspace();
    #position = 0;
    #failed = false;
    #disposed = false;
    #layerEvaluations = 0;
    hidden = new Float32Array(384);
    layerIds;
    parameterCount;
    shardHash;
    constructor(role, shard, backend = scalarBackend) {
        this.role = role;
        this.backend = backend;
        requireVerifiedShard(shard, role);
        this.parameterCount = shard.parameterCount;
        this.shardHash = shard.hash;
        this.#cache = new RoleKVCache(role);
        this.layerIds = Object.freeze(role === 'phone1' ? [0, 1, 2] : [3, 4, 5]);
        this.#blocks = this.layerIds.map((layer, i) => new TransformerBlock(shard, layer, this.#cache.layers[i], backend));
    }
    get position() { return this.#position; }
    get stats() {
        return { role: this.role, backend: this.backend.name, position: this.#position, layerIds: [...this.layerIds],
            layerEvaluations: this.#layerEvaluations, kvBytes: this.#cache.byteLength, wasmMemoryBytes: this.backend.wasmMemoryBytes ?? 0,
            cacheLengths: this.#cache.layers.map(layer => layer.length), failed: this.#failed, disposed: this.#disposed };
    }
    validatePosition(position) {
        if (this.#disposed)
            throw new Error('Engine disposed');
        if (this.#failed)
            throw new Error('Failed generation requires reset');
        assertPosition(position);
        if (position !== this.#position)
            throw new Error(`Expected position ${this.#position}, received ${position}`);
    }
    runBlocks(position) {
        for (const block of this.#blocks) {
            block.forwardInPlace(this.hidden, position, this.#workspace);
            this.#layerEvaluations++;
        }
    }
    finish() {
        for (const value of this.hidden)
            if (!Number.isFinite(value))
                throw new Error('Nonfinite hidden state');
        this.#position++;
    }
    fail(error) { this.#failed = true; throw error; }
    reset() {
        if (this.#disposed)
            throw new Error('Engine disposed');
        this.#cache.reset();
        this.hidden.fill(0);
        this.#position = 0;
        this.#layerEvaluations = 0;
        this.#failed = false;
    }
    /** Copies only occupied cache entries for diagnostics; not used in inference. */
    cacheSnapshot() {
        return this.#cache.layers.map((layer, i) => ({ layer: this.layerIds[i], length: layer.length,
            keys: layer.keys.slice(0, layer.length * 384), values: layer.values.slice(0, layer.length * 384) }));
    }
    dispose() {
        if (!this.#disposed) {
            this.reset();
            this.backend.dispose?.();
            this.#disposed = true;
        }
    }
}
