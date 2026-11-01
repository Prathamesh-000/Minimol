/** Boundary payload only. Versioned network message framing belongs to M3. */
export function encodeActivation(values) {
    if (!(values instanceof Float32Array) || values.length !== 384)
        throw new Error('Expected 384 FP32 activations');
    const buffer = new ArrayBuffer(1536), view = new DataView(buffer);
    for (let i = 0; i < 384; i++) {
        if (!Number.isFinite(values[i]))
            throw new Error('Nonfinite activation');
        view.setFloat32(i * 4, values[i], true);
    }
    return buffer;
}
export function decodeActivation(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 1536)
        throw new Error('Activation payload must be exactly 1536 bytes');
    const output = new Float32Array(384), view = new DataView(buffer);
    for (let i = 0; i < 384; i++) {
        output[i] = view.getFloat32(i * 4, true);
        if (!Number.isFinite(output[i]))
            throw new Error('Nonfinite activation');
    }
    return output;
}
