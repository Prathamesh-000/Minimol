# miniMol architecture

## Scope and delivery status

miniMol implements the attached **P2P Mobile Mesh Inference** specification. The
current delivery includes Milestones 1–4 browser functionality: the PyTorch reference, verified
FP32 shards, golden vectors, browser CPU engines, incremental KV caches, Workers,
and optional C++ WASM/SIMD matrix acceleration, plus a verified distributed binary
protocol, two-process simulation and real browser WebRTC transport. Milestones 5–8
and physical two-phone validation remain pending.
This document specifies the complete system, not a claim that all parts exist.

## Invariants

M4 adds `WebRTCTransport` and host-only `PeerPairing` without changing the M3 wire
format or coordinator. Each role's distributed runtime executes in its own Worker;
the main thread bridges binary frames to its reliable ordered DataChannel with
bounded backpressure. Manual completed offer/answer text replaces simulation
signaling. Selected host-candidate stats and model HELLO/READY must both pass.
The static demo build is `demo-dist/`; see MILESTONE_4_REPORT.md for execution
evidence, worker bridge details and physical-device limitations.

Optional explicit Wi-Fi IPv4 pairing replaces mDNS addresses only in exported UDP
host candidates, preserving browser-generated ports, ICE credentials and DTLS
fingerprints. Selected host/host verification and the model handshake still gate
generation. A development-only `/network-info` helper returns the caller's own
socket IP as a suggestion; it stores no peers, exchanges no SDP and never receives
activation data. Manual IP entry works on static hosts without this helper.

- Exactly 256 UTF-8 byte IDs, 512 positions, 6 pre-LayerNorm decoder blocks,
  hidden width 384, 6 heads of width 64, MLP width 1536, and 11,040,768 FP32 weights.
- Phone 1 owns token/position embeddings and blocks 0–2 only. Phone 2 owns blocks
  3–5, final LayerNorm, and the untied bias-free output head only.
- Every prompt byte and every autoregressive inference step requires both roles.
  Each phone retains only its own three layers' KV caches (4,718,592 bytes each).
- All production tensor computation runs on browser CPUs, first scalar
  TypeScript, then C++/WASM with scalar fallback and optional SIMD. No GPU APIs,
  native mobile binaries, cloud inference, external AI/runtime services, or
  server-side activation processing are permitted.
- The sole transport is a reliable ordered WebRTC DataChannel with
  `RTCPeerConnection({ iceServers: [] })`. No STUN, TURN, signaling server,
  activation router, or silent relay fallback.
- Static HTTPS distributes bundled app assets and role-specific shards. The full
  `weights.bin` stays outside `public/` and is development tooling only.
- Each role verifies SHA-256 before inference. Both roles must complete the model
  and protocol handshake before either can generate.

## Components and trust boundaries

```text
Development / Python CPU only
  config -> seeded PyTorch reference -> artifacts/model/weights.bin
                                   -> public/model/{manifest.json,phone1.bin,phone2.bin}
                                   -> tests/fixtures/golden_vectors.json

Phone 1 browser                              Phone 2 browser
  React UI / state machine                    React UI / state machine
  role-specific cache + SHA-256                role-specific cache + SHA-256
  inference Worker                            inference Worker
    embeddings + blocks 0–2                     blocks 3–5 + LN + head
    local KV cache                              local KV cache
         |                                            ^
         +--- activation: 384 little-endian FP32 ------+
         <--- predicted byte + local compute duration -+
                 direct ordered DataChannel
```

Python, PyTorch, and full-model execution are build/test dependencies only. They
are never deployed as an inference endpoint. Browser inference, networking,
offline storage, metrics, and presentation stay in separate modules. Workers
isolate CPU work from rendering. The interface supports `load(role, shard)`,
`reset()`, and `step(input, position)`; Phone 1 takes a byte and returns 384 floats,
while Phone 2 takes 384 floats and returns the greedy byte and optional debug
logits. No browser engine exposes full-model execution.

## Reference and binary format (Milestone 1)

`model/model_config.json` is the architecture source of truth. Canonical module
construction, tensor ordering, shape schema, and byte offsets are explicit.
Weights are headerless, contiguous little-endian float32, row-major; PyTorch
linear weights retain `[out_features, in_features]` layout. The internal manifest
describes the full file and shards; the public manifest exposes only shards.
Verification checks the exact independent schema, contiguous coverage, sizes,
finite FP32 values, hashes, and byte-for-byte full-file reconstruction.

The full reference computes causal batched logits on CPU. Development-only
reference shard classes load disjoint state dictionaries and validate the split
against that full model. This is model export validation, not the future binary
protocol/distributed-runtime test required by Milestone 3.

## Implemented CPU engine (Milestone 2)

`src/inference/` contains the strict manifest/shard loader, row-major FP32 matrix
kernels, byte/position embeddings, LayerNorm, erf GELU, single-query six-head
attention, residual/MLP blocks, and two role-specific engines. Phone 1 returns a
384-float activation; Phone 2 returns the greedy byte and position. Logits require
explicit debug mode. There is no full-model browser engine.

Each role allocates exactly 4,718,592 cache bytes with three independent K/V pairs
laid out `[position, head, dimension]`. One step updates each assigned layer once;
previous prompt bytes are never recomputed. Positions and cache lengths advance
together. Compute failure blocks further steps until reset. Reset clears caches,
counters and position. All three blocks reuse one scratch workspace per role.

`src/workers/inference.worker.ts` fixes a role at creation, loads only its verified
shard, serializes requests, bounds its queue, and returns measured local durations.
`workerRuntime.ts` also runs in isolated Node workers for validation. Activation
payloads use exactly 1,536 little-endian bytes. Worker control messages are not the
M3 versioned network protocol or M4 WebRTC transport.

The TypeScript scalar backend remains available. `wasm/src/matrix.cpp` builds
standalone scalar/SIMD matrix kernels without external imports. Each role creates
its own bounded WASM memory, caches only its own matrix weights, and reuses I/O
buffers. Other Transformer operations stay TypeScript. Backend selection tries
SIMD, scalar WASM, then TypeScript, exposing its selection and fallback reasons.

Validation covers Node, isolated workers whose directories contain only their
own shards, and separate Chrome contexts with browser Workers. The Chrome test
driver relays bytes locally; it does not establish a direct phone connection.
See MILESTONE_2_REPORT.md for evidence and remaining gates.

## Implemented distributed protocol (Milestone 3)

`src/networking/protocol.ts` defines strict protocol-v1 encoding and decoding.
`transport.ts` defines the reliable ordered binary transport contract and bounded
sender. `src/distributed/runtime.ts` wraps one existing role engine with handshake,
request correlation, deadlines, cache lifecycle and participation counters.
`coordinator.ts` runs prefill and feedback inside Phone 1's runtime; it never
receives Phone 2 weights or computes its layers. See PROTOCOL.md for wire layout.

HELLO/READY validates opposite roles and exact configuration/shard identities.
START/STARTED resets both caches and establishes a generation. Every position
exchanges ACTIVATION/NEXT_BYTE with matching connection, generation, request and
position fields. STOP is acknowledged. Errors/timeouts invalidate the connection
and clear caches; uncertain activations are never retried. Debug logits require
bilateral negotiation and a per-request flag.

The development harness launches two separate Node processes with separate heaps
and directories containing only their assigned shard/manifest. A local IPC broker
forwards binary frames without inference. The core runtime has no Node imports;
M4 can implement BinaryTransport over RTCDataChannel without changing wire framing.
No WebRTC implementation or physical-phone result is claimed in M3.

## Generation and state machine

Required states: `DISCONNECTED`, `LOADING_MODEL`, `MODEL_READY`, `OFFER_CREATED`,
`WAITING_FOR_PEER`, `CONNECTING`, `CONNECTED`, `PREFILLING`, `GENERATING`,
`COMPLETED`, `ERROR`. A role is immutable for a connection. Errors, disconnects,
stop, or a new generation invalidate pending requests and reset both caches.

TextEncoder produces bytes. Prefill processes each prompt byte in order through
both phones. Only the prediction from the last prompt byte starts generated
output. Subsequent predictions feed back as bytes. Greedy temperature 0 chooses
the lowest ID on ties. TextDecoder streams output with replacement handling for
invalid UTF-8; raw byte counts and IDs remain authoritative. Empty prompts are
rejected because the vocabulary has no BOS token. Generation halts before any
model input position exceeds 511; no implicit truncation or rolling positions.

## Pairing and protocol (Milestones 3–4)

Phone 1 creates the ordered reliable channel and completed non-trickle offer;
Phone 2 produces the completed answer. Bundle QR encoding/scanning dependencies
locally and use camera browser APIs. Oversized SDP has a reliable manual text
copy/paste fallback; no remote QR services. Bound and validate signaling input,
handle camera denial and malformed SDP, and support retry/disconnect.

The binary protocol will define a fixed magic/version/type/length header, session
and request IDs, and a position. Messages cover HELLO, READY, ACTIVATION,
NEXT_BYTE, BENCHMARK_START/RESULT, STOP, ERROR, PING/PONG (and prefill metadata as
needed). HELLO checks protocol version, config ID and hash, opposite role, expected
shard hash, width, vocabulary, context, and dtype. ACTIVATION is exactly 1,536
payload bytes; NEXT_BYTE includes the byte and Phone 2's local elapsed duration.
Use DataView little-endian reads/writes, not host-endian assumptions or JSON
float arrays. Validate sizes, finite floats, IDs, positions, state, and monotonic
ordering; correlate requests, reject duplicates, time out and stop on failure.
Apply bounded DataChannel backpressure without dropping messages.

Inspect `getStats()` for the selected ICE candidate pair and confirm a direct
host path. Transport open alone is not application-ready. If connectivity fails,
explain Wi-Fi client isolation/hotspot/browser limits and suggest retrying a
compatible local network. Never claim universal host-only connectivity.

## Offline, UI, and performance (Milestones 5–8)

React/TypeScript/Vite will present miniMol with the required **MESH INFERENCE**
landing label and subtitle **Distributed AI across two smartphones**. A mobile
dark dashboard shows role ownership, browser and CPU/WASM support, loading and
integrity, pairing/QR/manual exchange, prompt/generate/stop controls, byte/context
counts, temperatures, execution flow, and actual measured metrics. No fake output,
fake connection status, or fabricated performance numbers.

Versioned Service Worker/Cache API storage caches the app shell and **only the
selected role's shard**, rechecks integrity, and reports APPLICATION CACHED,
MODEL SHARD VERIFIED, and READY FOR OFFLINE INFERENCE separately. No remote
fonts/scripts/images/CDNs/analytics or runtime APIs. Offline means no Internet,
with the local Wi-Fi/hotspot still functioning. Cache quota/eviction is an error
condition to expose, not a promise of permanent storage.

Benchmarks use fixed prompts/model/temperature, warm-up, configurable output
length, local `performance.now()` durations, average/median over sufficient
samples, per-role compute, end-to-end latency, estimated communication overhead,
bytes transferred, buffers, cache memory, and device/browser metadata. Never
subtract absolute clocks across phones. Optimization order: scalar correctness,
distributed execution, incremental KV caching, Workers, WASM, SIMD, allocation
and communication improvements, then real mobile measurements.

## Validation and completion gates

Milestone 1 tests independent parameter accounting, all architecture dimensions,
default initialization order, deterministic bytes, corruption rejection, shard
ownership/reconstruction, embeddings, causal attention, LayerNorm, exact GELU/MLP,
context and invalid-input policies, and golden activations/logits/greedy IDs.
Later gates add scalar/KV differential tests, isolated two-runtime binary
simulation with participation counters, WebRTC error and recovery tests, and
physical iPhone Safari/Android Chrome/offline trials. Desktop automation cannot
establish physical device compatibility. See TASKS.md for acceptance criteria and
SPEC_DECISIONS.md for unresolved risks. The project is complete only when every
master-prompt definition-of-done item has evidence.

## M5 offline and presentation additions

The existing model/protocol/coordinator remain unchanged. A role-local Worker
cache wrapper verifies bytes before storing and again before loading. Shell
assets are separately precached by a generated service worker with safe update
activation; binaries never enter shell precaching. One role per browser profile.
Bundled QR encoder/decoder exchange bounded, checked chunks of the same SDP text.
Manual/direct-IP pairing stays available. A responsive HTML/TypeScript dashboard
uses real engine/counter data. See MILESTONE_5_REPORT.md for executed offline and
QR-image tests, the byte-counter correction and physical-device limitations.
