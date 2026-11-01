/** Exact v1 contract, checked against the unchanged Python config by tests. */
export const MODEL_CONFIG = Object.freeze({
  model_id: 'minimol-byte-gpt-v1', architecture: 'pre-ln-causal-gpt',
  vocab_size: 256, max_seq_len: 512, n_layers: 6, hidden_dim: 384,
  n_heads: 6, head_dim: 64, ff_dim: 1536, layer_norm_eps: 1e-5,
  gelu_approximate: 'none', linear_bias: true, lm_head_bias: false,
  tie_embeddings: false, dtype: 'float32', split_layer: 3, parameter_count: 11040768,
});
// Python hashes its sorted compact JSON using 1e-05 rather than JS's 0.00001.
// Validate config fields independently and bind to its canonical Python hash.
export const CONFIG_SHA256 = '307401b815cf19d2919b799f793a46e810a3bd2857f5da1abf661c4476c390ec';
export type Role = 'phone1' | 'phone2';
export const ROLE_COUNTS = Object.freeze({ phone1: 5618304, phone2: 5422464 });
export const KV_BYTES_PER_ROLE = 4718592;
export const HIDDEN = 384;

export function assertRole(role: unknown): asserts role is Role {
  if (role !== 'phone1' && role !== 'phone2') throw new Error('Role must be phone1 or phone2');
}
export function assertPosition(position: number): void {
  if (!Number.isInteger(position) || position < 0 || position >= 512) throw new Error('Position must be 0–511');
}
export function assertByte(byte: number): void {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('Byte must be an integer from 0–255');
}
