import { assertPosition, assertRole, KV_BYTES_PER_ROLE } from './modelConfig.js';
export class LayerKVCache {
    keys;
    values;
    #length = 0;
    constructor(keys, values) {
        this.keys = keys;
        this.values = values;
        if (keys.length !== 512 * 384 || values.length !== 512 * 384)
            throw new Error('Invalid KV allocation');
    }
    get length() { return this.#length; }
    append(qkv, position) {
        assertPosition(position);
        if (position !== this.#length)
            throw new Error('KV position must be the next sequential position');
        if (qkv.length !== 1152)
            throw new Error('Invalid fused QKV length');
        for (const value of qkv)
            if (!Number.isFinite(value))
                throw new Error('Nonfinite QKV');
        const start = position * 384;
        for (let i = 0; i < 384; i++) {
            this.keys[start + i] = qkv[384 + i];
            this.values[start + i] = qkv[768 + i];
        }
        this.#length++;
    }
    reset() { this.keys.fill(0); this.values.fill(0); this.#length = 0; }
}
export class RoleKVCache {
    role;
    layers;
    byteLength = KV_BYTES_PER_ROLE;
    constructor(role) {
        this.role = role;
        assertRole(role);
        const storage = new Float32Array(KV_BYTES_PER_ROLE / 4), size = 512 * 384;
        this.layers = Object.freeze(Array.from({ length: 3 }, (_, layer) => new LayerKVCache(storage.subarray(layer * 2 * size, (layer * 2 + 1) * size), storage.subarray((layer * 2 + 1) * size, (layer * 2 + 2) * size))));
    }
    reset() { for (const layer of this.layers)
        layer.reset(); }
}
