import { causalAttention } from './attention.js';
import { addResidualInPlace, feedForward } from './feedForward.js';
import { layerNorm } from './layerNorm.js';
/** One reusable workspace shared sequentially across the role's three blocks. */
export class BlockWorkspace {
    normalized = new Float32Array(384);
    qkv = new Float32Array(1152);
    attention = new Float32Array(384);
    update = new Float32Array(384);
    expanded = new Float32Array(1536);
    scores = new Float32Array(512);
}
export class TransformerBlock {
    cache;
    backend;
    #ln1;
    #ln2;
    #qkv;
    #projection;
    #mlp;
    constructor(shard, layer, cache, backend) {
        this.cache = cache;
        this.backend = backend;
        const get = (suffix) => shard.tensor(`blocks.${layer}.${suffix}`);
        this.#ln1 = [get('ln1.weight'), get('ln1.bias')];
        this.#qkv = [get('attn.qkv.weight'), get('attn.qkv.bias')];
        this.#projection = [get('attn.proj.weight'), get('attn.proj.bias')];
        this.#ln2 = [get('ln2.weight'), get('ln2.bias')];
        this.#mlp = { first: get('mlp.fc1.weight'), firstBias: get('mlp.fc1.bias'), second: get('mlp.fc2.weight'), secondBias: get('mlp.fc2.bias') };
    }
    forwardInPlace(hidden, position, scratch) {
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
