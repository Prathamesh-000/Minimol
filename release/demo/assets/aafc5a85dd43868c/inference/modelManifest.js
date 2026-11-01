import { CONFIG_SHA256, MODEL_CONFIG, ROLE_COUNTS } from './modelConfig.js';
function sameValue(actual, expected) {
    if (Array.isArray(expected))
        return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => sameValue(actual[i], v));
    if (expected !== null && typeof expected === 'object') {
        if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
            return false;
        const a = actual, e = expected;
        return Object.keys(a).length === Object.keys(e).length && Object.keys(e).every(k => sameValue(a[k], e[k]));
    }
    return actual === expected;
}
/** An independent schema prevents a manifest from granting a role extra layers. */
export function expectedTensors() {
    const specs = [
        ['token_embedding.weight', [256, 384], 'phone1'], ['position_embedding.weight', [512, 384], 'phone1'],
    ];
    for (let layer = 0; layer < 6; layer++) {
        const role = layer < 3 ? 'phone1' : 'phone2';
        const shapes = [
            ['ln1.weight', [384]], ['ln1.bias', [384]], ['attn.qkv.weight', [1152, 384]], ['attn.qkv.bias', [1152]],
            ['attn.proj.weight', [384, 384]], ['attn.proj.bias', [384]], ['ln2.weight', [384]], ['ln2.bias', [384]],
            ['mlp.fc1.weight', [1536, 384]], ['mlp.fc1.bias', [1536]], ['mlp.fc2.weight', [384, 1536]], ['mlp.fc2.bias', [384]],
        ];
        for (const [suffix, shape] of shapes)
            specs.push([`blocks.${layer}.${suffix}`, shape, role]);
    }
    specs.push(['final_ln.weight', [384], 'phone2'], ['final_ln.bias', [384], 'phone2'], ['lm_head.weight', [256, 384], 'phone2']);
    let full = 0;
    const offsets = { phone1: 0, phone2: 0 };
    return specs.map(([name, shape, owner]) => {
        const numel = shape.reduce((a, b) => a * b, 1), byte_length = numel * 4;
        const entry = { name, shape, owner, numel, byte_length, dtype: 'float32', canonical_offset_bytes: full, offset_bytes: offsets[owner] };
        full += byte_length;
        offsets[owner] += byte_length;
        return entry;
    });
}
export function validateManifest(value) {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid manifest');
    const m = value;
    if (m.format_version !== 1 || m.dtype !== 'float32' || m.byte_order !== 'little' || m.layout !== 'row-major'
        || m.parameter_count !== 11040768 || m.config_sha256 !== CONFIG_SHA256
        || !sameValue(m.model_config, MODEL_CONFIG) || !sameValue(m.tensors, expectedTensors()))
        throw new Error('Manifest does not match exact miniMol v1 schema');
    if (!m.files || Object.keys(m.files).sort().join(',') !== 'phone1,phone2')
        throw new Error('Only two role shards may be listed');
    for (const role of ['phone1', 'phone2']) {
        const f = m.files[role];
        if (!f || f.name !== `${role}.bin` || f.byte_length !== ROLE_COUNTS[role] * 4 || f.parameter_count !== ROLE_COUNTS[role]
            || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256))
            throw new Error(`Invalid ${role} file metadata`);
    }
    // Snapshot untrusted metadata so changes during asynchronous hashing cannot alter it.
    // Rebuild the validated contract without requiring structuredClone, executing
    // untrusted toJSON methods, or retaining caller-owned shape/offset arrays.
    const files = {};
    for (const role of ['phone1', 'phone2'])
        files[role] = {
            name: `${role}.bin`, byte_length: ROLE_COUNTS[role] * 4,
            parameter_count: ROLE_COUNTS[role], sha256: m.files[role].sha256,
        };
    return { format_version: 1, dtype: 'float32', byte_order: 'little', layout: 'row-major',
        config_sha256: CONFIG_SHA256, parameter_count: 11040768, model_config: { ...MODEL_CONFIG },
        tensors: expectedTensors(), files };
}
