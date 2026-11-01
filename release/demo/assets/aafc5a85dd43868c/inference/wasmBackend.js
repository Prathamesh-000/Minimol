import { ROLE_COUNTS } from './modelConfig.js';
import { scalarBackend } from './matrixMultiply.js';
class WasmLinearBackend {
    name;
    #kernel;
    #copies = new Map();
    #cursor;
    #input;
    #output;
    #inputView;
    #outputView;
    get wasmMemoryBytes() { return this.#kernel.memory.buffer.byteLength; }
    #capacity;
    #disposed = false;
    constructor(instance, role) {
        this.#kernel = instance.exports;
        if (this.#kernel.kernel_version() !== 1)
            throw new Error('Unsupported WASM matrix kernel');
        this.name = this.#kernel.kernel_simd() ? 'wasm-simd' : 'wasm-scalar';
        this.#cursor = Number(this.#kernel.__heap_base.value);
        // Bounded role-local memory; at most one copy of its own matrix weights.
        this.#capacity = Math.ceil((this.#cursor + ROLE_COUNTS[role] * 4 + 65536) / 65536) * 65536;
        const pages = (this.#capacity - this.#kernel.memory.buffer.byteLength) / 65536;
        if (pages > 0)
            this.#kernel.memory.grow(pages);
        this.#input = this.allocate(1536 * 4);
        this.#output = this.allocate(1536 * 4);
        this.#inputView = new Float32Array(this.#kernel.memory.buffer, this.#input, 1536);
        this.#outputView = new Float32Array(this.#kernel.memory.buffer, this.#output, 1536);
    }
    allocate(bytes) {
        const pointer = (this.#cursor + 15) & ~15;
        if (pointer + bytes > this.#capacity)
            throw new Error('WASM role memory exhausted');
        this.#cursor = pointer + bytes;
        return pointer;
    }
    copyOnce(array) {
        let pointer = this.#copies.get(array);
        if (pointer === undefined) {
            pointer = this.allocate(array.byteLength);
            new Float32Array(this.#kernel.memory.buffer, pointer, array.length).set(array);
            this.#copies.set(array, pointer);
        }
        return pointer;
    }
    linear(weights, input, bias, output) {
        if (this.#disposed)
            throw new Error('WASM backend disposed');
        if (!input.length || input.length > 1536 || output.length > 1536 || weights.length !== input.length * output.length || (bias && bias.length !== output.length))
            throw new Error('WASM linear shape mismatch');
        const wp = this.copyOnce(weights), bp = bias ? this.copyOnce(bias) : 0;
        this.#inputView.set(input);
        this.#kernel.matvec(wp, this.#input, bp, this.#output, output.length, input.length);
        output.set(this.#outputView.subarray(0, output.length));
    }
    dispose() {
        if (!this.#disposed) {
            new Uint8Array(this.#kernel.memory.buffer).fill(0);
            this.#copies.clear();
            this.#disposed = true;
        }
    }
}
export async function instantiateWasmBackend(bytes, role) {
    const module = await WebAssembly.compile(bytes);
    if (WebAssembly.Module.imports(module).length)
        throw new Error('Matrix kernel must not import external services');
    return new WasmLinearBackend(await WebAssembly.instantiate(module), role);
}
/** Missing/unsupported optional kernels explicitly report fallback; no fake WASM. */
export async function selectBackend(role, preference = 'auto', baseUrl, fetcher = fetch) {
    if (!['typescript', 'wasm-scalar', 'wasm-simd', 'auto'].includes(preference))
        throw new Error('Unknown backend');
    if (preference === 'typescript')
        return { backend: scalarBackend, fallbackReasons: [] };
    const candidates = preference === 'wasm-scalar' ? ['scalar'] : ['simd', 'scalar'];
    const fallbackReasons = [];
    const base = new URL(baseUrl, globalThis.location?.href);
    if (!base.pathname.endsWith('/'))
        base.pathname += '/';
    for (const candidate of candidates) {
        try {
            const response = await fetcher(new URL(`matrix-${candidate}.wasm`, base), { redirect: 'error' });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const backend = await instantiateWasmBackend(await response.arrayBuffer(), role);
            if (backend.name !== `wasm-${candidate}`) {
                backend.dispose?.();
                throw new Error('Kernel variant mismatch');
            }
            return { backend, fallbackReasons };
        }
        catch (error) {
            fallbackReasons.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { backend: scalarBackend, fallbackReasons };
}
