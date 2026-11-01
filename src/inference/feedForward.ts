import { geluInPlace } from './gelu.js';
import { type LinearBackend } from './matrixMultiply.js';

export interface FeedForwardWeights { first: Float32Array; firstBias: Float32Array; second: Float32Array; secondBias: Float32Array }
export function feedForward(input: Float32Array, weights: FeedForwardWeights, expanded: Float32Array, output: Float32Array, backend: LinearBackend): void {
  backend.linear(weights.first, input, weights.firstBias, expanded);
  geluInPlace(expanded);
  backend.linear(weights.second, expanded, weights.secondBias, output);
}

export function addResidualInPlace(residual: Float32Array, update: Float32Array): void {
  if (residual.length !== update.length) throw new Error('Residual shape mismatch');
  for (let i = 0; i < residual.length; i++) residual[i] += update[i];
}
