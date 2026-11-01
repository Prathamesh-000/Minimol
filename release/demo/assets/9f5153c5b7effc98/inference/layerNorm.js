export function layerNorm(input, weight, bias, output, epsilon = 1e-5) {
    const n = input.length;
    if (!n || weight.length !== n || bias.length !== n || output.length !== n || !(epsilon > 0))
        throw new Error('LayerNorm shape/epsilon mismatch');
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += input[i];
    const mean = sum / n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
        const delta = input[i] - mean;
        variance += delta * delta;
    }
    const inverse = 1 / Math.sqrt(variance / n + epsilon);
    for (let i = 0; i < n; i++)
        output[i] = (input[i] - mean) * inverse * weight[i] + bias[i];
}
