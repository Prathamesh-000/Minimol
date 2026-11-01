/** Row-major [out, in] x vector, no transpose/copies and no per-call allocations.
 * Four independent FP32 accumulators reduce loop dependencies. The reduction
 * order is fixed; this is also the layout used by the optional WASM SIMD kernel.
 */
const f32 = Math.fround;
export function matVec(weights, input, bias, output) {
    const cols = input.length, rows = output.length;
    if (!cols || weights.length !== rows * cols || (bias && bias.length !== rows))
        throw new Error('Linear shape mismatch');
    for (let row = 0; row < rows; row++) {
        const base = row * cols;
        let a = 0, b = 0, c = 0, d = 0, col = 0;
        for (; col + 3 < cols; col += 4) {
            a = f32(a + f32(weights[base + col] * input[col]));
            b = f32(b + f32(weights[base + col + 1] * input[col + 1]));
            c = f32(c + f32(weights[base + col + 2] * input[col + 2]));
            d = f32(d + f32(weights[base + col + 3] * input[col + 3]));
        }
        let sum = f32(f32(f32(a + b) + c) + d);
        for (; col < cols; col++)
            sum = f32(sum + f32(weights[base + col] * input[col]));
        output[row] = f32(sum + (bias ? bias[row] : 0));
    }
}
/** Batched matrix multiply in the same row-major layout; GEMV is the hot path. */
export function matMul(weights, inputs, rows, cols, batch, output, bias) {
    if (![rows, cols, batch].every(n => Number.isInteger(n) && n > 0) || inputs.length !== batch * cols || output.length !== batch * rows)
        throw new Error('Matrix shape mismatch');
    for (let i = 0; i < batch; i++)
        matVec(weights, inputs.subarray(i * cols, (i + 1) * cols), bias, output.subarray(i * rows, (i + 1) * rows));
}
export const scalarBackend = Object.freeze({ name: 'typescript-scalar', linear: matVec });
