import { geluInPlace } from './gelu.js';
export function feedForward(input, weights, expanded, output, backend) {
    backend.linear(weights.first, input, weights.firstBias, expanded);
    geluInPlace(expanded);
    backend.linear(weights.second, expanded, weights.secondBias, output);
}
export function addResidualInPlace(residual, update) {
    if (residual.length !== update.length)
        throw new Error('Residual shape mismatch');
    for (let i = 0; i < residual.length; i++)
        residual[i] += update[i];
}
