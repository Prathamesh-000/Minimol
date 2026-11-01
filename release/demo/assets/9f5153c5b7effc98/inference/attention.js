const f32 = Math.fround;
/** A single causal query against this layer's previous K/V entries plus itself. */
export function causalAttention(qkv, cache, position, output, scores) {
    if (output.length !== 384 || scores.length !== 512)
        throw new Error('Attention workspace shape mismatch');
    cache.append(qkv, position);
    const length = position + 1;
    output.fill(0);
    for (let head = 0; head < 6; head++) {
        const headStart = head * 64;
        let max = -Infinity;
        for (let time = 0; time < length; time++) {
            const offset = time * 384 + headStart;
            let a = 0, b = 0, c = 0, d = 0;
            for (let col = 0; col < 64; col += 4) {
                a = f32(a + f32(qkv[headStart + col] * cache.keys[offset + col]));
                b = f32(b + f32(qkv[headStart + col + 1] * cache.keys[offset + col + 1]));
                c = f32(c + f32(qkv[headStart + col + 2] * cache.keys[offset + col + 2]));
                d = f32(d + f32(qkv[headStart + col + 3] * cache.keys[offset + col + 3]));
            }
            scores[time] = f32(f32(f32(f32(a + b) + c) + d) / 8);
            max = Math.max(max, scores[time]);
        }
        let sum = 0;
        for (let time = 0; time < length; time++) {
            scores[time] = Math.exp(f32(scores[time] - max));
            sum += scores[time];
        }
        for (let time = 0; time < length; time++)
            scores[time] = scores[time] / sum;
        for (let time = 0; time < length; time++) {
            const probability = scores[time], start = time * 384 + headStart;
            for (let col = 0; col < 64; col++)
                output[headStart + col] = f32(output[headStart + col] + f32(probability * cache.values[start + col]));
        }
    }
}
