# miniMol implementation milestones

Status legend: `[x]` executed and verified; `[ ]` pending. Completion requires
recorded test evidence. Never proceed through a failed dependent gate.

## Pre-implementation

- [x] Read the complete supplied master prompt.
- [x] Inspect repository and tools: empty directory, no Git repository or applicable
  AGENTS.md; Python 3.12.5, Node 24.6.0, npm 11.5.1; PyTorch/pytest/emcc/cmake absent.
- [x] Write ARCHITECTURE.md and SPEC_DECISIONS.md before implementation.
- [x] Document ambiguities, constraints, risks, and all milestone gates.

## M1 — Canonical reference and weights (complete)

- [x] Install/pin isolated Python build/test dependencies.
- [x] Implement exact CPU FP32 PyTorch architecture and construction order.
- [x] Verify dimensions, 11,040,768 parameters, untied head, biases and activation.
- [x] Generate deterministic seed-42 canonical weights and explicit manifests.
- [x] Export Phone 1 (5,618,304) and Phone 2 (5,422,464) parameters only.
- [x] Independently verify sizes, schema, offsets, SHA-256, finite values and exact
  reconstruction; reject corruption and ownership/schema errors.
- [x] Generate hash-bound hidden/logit/greedy/autoregressive golden vectors.
- [x] Execute model, causal, normalization, GELU, UTF-8, input/context and
  shard-reload tests. Repeat export to establish byte reproducibility.
- [x] Record actual commands/results/hashes in the engineering report and README.

**Recorded result:** 65 tests passed in 4.17 seconds. Independent fresh-process
generation reproduced all three binaries, both manifests and the golden fixture
byte for byte. Split-reference activations/logits had zero absolute error over
seven cases / 553 input positions. See ENGINEERING_REPORT.md and artifacts/reports/.

**Exit:** all tests pass, full file is 44,163,072 bytes, shards are 22,473,216 and
21,689,856 bytes, public assets contain no full weights, and split reference
matches the full reference. Golden vectors exist for M2.

## M2 — Scalar CPU inference and KV cache (complete)

- [x] Implement role-restricted TypeScript engines and shared math: embeddings,
  LayerNorm, fused QKV, six-head scaled causal softmax, exact GELU/MLP, residuals,
  final norm and head; explicit FP32 boundaries and stable reduction order.
- [x] Implement per-role incremental KV caches, reset and position validation;
  assert 4,718,592 bytes per phone and no prompt recomputation each step.
- [x] Match all golden activations/logits within documented tolerance and all
  greedy IDs exactly; test ASCII, UTF-8, byte extrema, empty input, max context,
  repeated sessions and cache reset. Preserve a scalar correctness oracle.
- [x] Compile/test C++ scalar WASM and SIMD matrix kernels with scalar fallback.
- [x] Prove isolated-worker equivalence, role-only files, actual transferred
  activations and participation/cache counters for both runtimes.
- [x] Execute seven cases in separate Chrome contexts/Workers with TypeScript,
  scalar WASM and SIMD WASM (21 browser runs).
- [x] Preserve all 65 Python tests and record a measured desktop benchmark.

**Evidence:** MILESTONE_2_REPORT.md and artifacts/reports/milestone2-*. No WebRTC,
physical Safari/Android test or complete C++ Transformer port is claimed.

**Exit:** executed differential tests pass; no browser role can load or execute
the other role's modules. No GPU/native/server computation.

## M3 — Distributed simulation and protocol (verified)

M2 provides isolated role workers and raw little-endian activation serialization.
The versioned protocol is now implemented and verified with separate Node processes.

- [x] Specify versioned binary messages, explicit little-endian serialization,
  HELLO/READY checks, errors/stop, request/session/position correlation and bounds.
- [x] Run two independent runtimes with separate weights/caches through the exact
  production binary protocol. Instrument both roles for every prefill/generation
  request and prohibit a single-runtime full-model escape path.
- [x] Test output equality, malformed messages, wrong roles/models/hashes,
  stale/duplicate requests, timeout, reset, stop and maximum context.

**Executed:** 30 M3 tests passed; 28 M2 and 65 M1 regression tests passed.
Two distinct Node process IDs, separate shard directories, 595 positions per role,
and 1,785 layer evaluations per role are recorded in MILESTONE_3_REPORT.md.
Milestone 4 has not started.

**Exit:** full-vs-distributed tests pass with real 1,536-byte activation transfers
and one returned byte per request; prove both runtimes participate.

## M4 — Direct WebRTC and manual signaling (desktop browser verified)

- [x] Empty ICE servers; reliable ordered DataChannel; complete ICE gathering
  before offer/answer exchange. No signaling server or STUN/TURN.
- [x] Manual offer/answer copy/paste, bounds/error/retry/duplicate-pairing handling,
  as permitted by the M4 request. QR generation/scanning remains deferred.
- [x] Verify HELLO/READY and actual selected direct host candidate pair; meaningful
  local-network errors, backpressure, request deadlines and close handling.
- [x] Execute browser offer/answer/channel/activation/byte tests and failures:
  bad SDP, wrong role/hash, disconnect during generation, reconnection, timeout.

Chrome covers real connectivity, binary inference and connection failures; the
unchanged M3 suite covers incompatible model/role/hash handshake rejection.
All 123 prior tests pass, plus two signaling tests, three LAN-address tests and
three HTTPS-helper tests. Thirteen browser scenarios include actual UI generation
over explicit numeric host candidates and a controlled mDNS-resolution failure.
Physical smartphones have reported failed pairing; successful iOS Safari/Android
inference remains unverified. See MILESTONE_4_REPORT.md.

**Exit:** actual separate browser peers exchange real model results; no fake
connection status. Record tested browsers and remaining physical-device limits.

## M5 — Mobile UI and Worker integration

- [ ] React/TypeScript/Vite mobile dark interface; prescribed landing text, role
  cards, device/load/hash/offline/connection dashboard and pairing controls.
- [ ] Worker CPU execution; role-only fetch/load with SHA-256; generate/stop,
  UTF-8 display, byte/context counts, default temperature 0 and full state machine.
- [ ] Live measured compute/network/payload/buffer/progress indicators and visible
  two-role execution; no placeholders masquerading as inference or metrics.
- [ ] Test responsive layouts, permissions, accessibility, loading failures,
  peer readiness, worker errors and UI responsiveness during compute.

**Exit:** integrated app produces actual distributed results with responsive UI.

## M6 — Offline functionality

- [ ] Versioned Service Worker/Cache API shell, bundled dependencies, role-only
  shard caching, integrity checks, eviction/quota recovery and readiness states.
- [ ] Verify no remote fonts/scripts/images/CDNs/analytics/runtime APIs.
- [ ] Test after initial trusted HTTPS setup: disable WAN but preserve Wi-Fi or
  hotspot, reload both apps, pair, run inference and compare output.

**Exit:** executed offline test with cache/hash/network evidence. Offline app
loading alone does not prove offline distributed inference.

## M7 — Optimization and reproducible benchmarks

M2 supplies measured WASM/SIMD linear acceleration. Full-engine WASM porting,
mobile profiling and further allocation/transport optimization remain.

- [ ] Port correct engine to C++/WASM with scalar fallback, then optional SIMD;
  document compiler requirements; keep every numerical and role-isolation test.
- [ ] Reuse buffers, reduce copies/allocations, optimize single-query attention
  and matrix kernels; consider prefill batching only after correctness gates.
- [ ] Fixed prompt/model/temp-0 warm-up and repeated configurable-length runs;
  record wall time, bytes/sec, average/median latency, per-phone compute,
  estimated communication overhead, bytes, buffers and cache memory.
- [ ] Use local durations only, never compare different device absolute clocks.

**Exit:** measured improvements with unchanged correctness; actual device/browser
metadata and limits, no unexecuted performance claims.

## M8 — Physical integration and delivery

- [ ] Test iPhone Safari, Android Chrome, Android+Android and iPhone+Android on
  physical devices. Include Wi-Fi/hotspot, WAN-off, stop/disconnect/retry,
  context exhaustion, backgrounding, camera denial and cold/warm cache cases.
- [ ] Confirm each device fetches only its role's shard, owns only three layer
  caches, participates in every generation step, and uses a direct host path.
- [ ] Resolve failures; complete compatibility report, practical two-phone
  checklist, static HTTPS deployment guide and setup/pairing/offline/benchmark
  README. Keep development full weights out of deployment artifacts.
- [ ] Audit every master-prompt definition-of-done item and required deliverable.
  Publish final engineering report separating implemented/tested/incomplete and
  actual benchmark results. Mark COMPLETE only with all required evidence.

**Exit:** genuine physical two-phone distributed inference and offline use are
demonstrated. Automated simulations cannot substitute for this gate.

## User-requested M5 scope — completed automated implementation

- [x] Role-only verified shard caching, interrupted-download retry, quota errors.
- [x] Versioned offline shell, offline reload and HTTP-host-independent generation tests.
- [x] Bundled chunked QR generation/decoding, malformed/expired payload rejection, manual fallback.
- [x] Responsive dashboard with measured counters, cache/network/role/connection state.
- [x] Existing M1–M4 regressions plus new offline/QR/dashboard tests and demo build.
- [ ] Physical M5 iOS/Android camera and WAN-off reload/inference validation.

This request brings the earlier M6 cache work into M5. Prior roadmap entries
remain historical; see MILESTONE_5_REPORT.md for exact delivered scope. M4 physical
inference was reported successful by the user; no new physical test is claimed.
