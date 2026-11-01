# MEMBER 2 — BEGIN IMPLEMENTATION NOW (Browser CPU engine)

You own `web/src/engine/`, `web/scripts/check-parity.mjs`, and relevant engine tests. Do not modify network messages, HTML, website controls, model shape or exporter. `docs/01_FROZEN_CONTRACT.md` is frozen.

## Exact first tasks in order
1. Read `web/src/engine/kernels.js`, `engine.js`, shared model spec and frozen engine API. Study `linear`, `layerNorm`, `geluTanhInPlace`, causal `attentionStep`, `forwardByte`, `forwardActivation`.
2. Run `cd web && npm test` and `npm run parity` after Member 1's weights are generated; parity must match Python golden bytes for prompts `A`, `Hi`, `Mesh`, `é`. Current source was checked in Node against those fixtures with ~1e-6 max absolute cut/logit deviation.
3. Add low-level tests for qkv layout `[Q(384),K(384),V(384)]`, 6 heads x 64 dimensions, cache indices, causal softmax, last-token logits and resets. Validate against PyTorch intermediate vectors, not merely output bytes.
4. Test 512-token cache boundary, invalid/NaN activations, repeated two-run reset, non-ASCII multi-byte prompts. No full model should be loaded into either role's browser engine.
5. Profile separately Phone 1 and Phone 2 CPU time. Baseline kernels are **correct but not optimized**. Keep reference JS paths while introducing optional fast kernels, with automatic fallback on Safari and Chrome. Prioritize preallocated buffers, BLAS-like matvec loops, off-main-thread Web Worker; then explore portable WASM SIMD on CPU if required. Never use WebGPU/WebGL.
6. Share `createEngine`, `reset`, `forwardByte`, `forwardActivation` exactly as frozen. Do not insert mocks in production. Provide a small reproducible benchmark showing tokens/sec and correctness with/without optimization.

## Hard-coded contracts
`forwardByte({token,position}) -> Promise<Float32Array(384)>` Phone 1 only. `forwardActivation({activation,position,sample}) -> Promise<{byte:number|null, logits?: Float32Array(256)}>` Phone 2 only. Each call sequential from position 0. Three blocks per role. 512 max positions. Model files are generated and hashed by Member 1. Activation packets are produced by Member 3, not the engine.

## Your pull request must include
Engine kernels, engine APIs, mathematical tests, parity results, benchmark numbers, and any explicit optimization fallback behavior. If a change makes the golden byte IDs differ, reject it until debugged.

## Paste this into your own coding LLM
"I am Member 2, owner of ONLY web/src/engine/**, web/scripts/check-parity.mjs and engine tests in our Minimol P2P implementation repo. Read README.md, docs/01_FROZEN_CONTRACT.md and current engine code. Continue the already functioning FP32 JS CPU transformer, preserve the exported tensor names and engine API, and use Member 1's fixtures to verify math after every change. Add focused tests and optimize step-by-step on CPU (JS/Web Worker/WASM only) while keeping a reference implementation and mobile Safari fallback. Do not rewrite network, UI, Python reference or shared contracts. Start with tests and a performance baseline, then implementation diffs with exact validation commands and results."
