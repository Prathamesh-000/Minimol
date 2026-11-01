# miniMol architecture and limitations

## Model and partition

Byte-level untrained causal decoder Transformer: vocabulary 256, context 512,
six pre-LayerNorm blocks, d_model 384, six heads ×64, feed-forward width 1536,
exact GELU and FP32 weights. Exactly 11,040,768 parameters. Phone 1's 5,618,304
parameters cover token/position embeddings and layers 0–2. Phone 2's 5,422,464
cover layers 3–5, final LayerNorm and untied output head. Deterministic seed-42
weights, canonical PyTorch golden vectors and original shard hashes are retained.

## Runtime and communication

Each browser runs a dedicated Worker with one verified role engine and independent
KV cache. CPU JavaScript math with optional C++ scalar/SIMD WASM linear kernels;
TypeScript fallback remains available. Neither role executes all six layers.
Phone 1's coordinator prefills every prompt byte, sends a 384-FP32 activation
(1536-byte payload) through the binary protocol over a reliable ordered real
WebRTC DataChannel, and waits for Phone 2's prediction. Phone 2 completes its three
layers/head. Next-byte feedback repeats that exchange; debug mode can return logits.

Completed manual or locally bundled chunked QR SDP exchange establishes the peer.
RTCPeerConnection uses iceServers:[]; selected host/host candidates are verified.
No signaling server, TURN, cloud inference, external activation relay or GPU APIs.
Own-Wi-Fi IPv4 export avoids mDNS lookup but cannot bypass blocked peer traffic.

Versioned binary messages validate identities, config/hash, role, lengths, position,
request/session/generation IDs and flags. Correlation, bounded queues, backpressure,
timeouts and disconnect handling reject uncertain work. Interrupted sessions require
fresh pairing and caches; no silent full-model fallback or uncertain automatic resume.

## KV and offline storage

Each phone allocates 4,718,592 bytes for its three layers' key/value history.
Appending one position extends every owned layer once; context cannot exceed 512.
Occupancy is position ×3×2×384×4, distinct from allocated capacity and total RAM.

A versioned service worker caches 37 M5 shell assets (M6 adds modules), manifest,
WASM and bundled QR dependencies. It never precaches model binaries. The role
loader stores only complete verified shard bytes and verifies size/SHA-256/FP32
again on each cached load. Failed downloads do not commit; corrupted entries are
removed and retried online. One active role per origin/browser profile is supported.
Safe update activation waits for old tabs to close. Cache persistence is best effort.

## Evidence and measurement

The validation panel records expected tests, manual result/error details, observed
QR/loading/offline/visibility events and browser metadata. NOT TESTED is the default.
Visibility does not prove a screen was locked; platform detection does not establish
physical device compatibility. Exported classification is operator-supplied evidence.

Worker timings measure model load/verification/backend setup, time to first output
(including START and prefill), per-position compute/exchange and total generation.
DataChannel RTT includes remote computation and scheduling; residual after compute
subtraction is not pure network latency. Local clocks are never compared across
phones. Optional JS heap is not total RAM. CPU-only desktop benchmarks have no
network measurement; mobile results require real device exports.

## Limits

Random initialization provides a deterministic computation workload, not learned
language statistics. Predictions score byte IDs, so readable English is not expected.
Tokens here are bytes, not words. Golden equality demonstrates implementation
correctness, not intelligence. No model accuracy or trained-language claim is made.

Physical M6 camera, WAN-off, reload/resume and benchmark trials remain NOT TESTED.
Storage eviction/private browsing, camera policy/optics, iOS suspension and Wi-Fi
client isolation can prevent a demo. Explicit manual pairing remains the fallback.
Downloads restart rather than resume ranges. No pure one-way latency measurement,
complete device-memory API, automatic uncertain-session recovery or universal
browser compatibility is claimed. QR checksums detect corruption, not human identity.

## M8 reliability additions

Active lifecycle invalidation, clock/liveness checks, Worker command failure bounds,
main-thread duplicate-generation guard and timer/listener cleanup protect uncertain
KV state. Pending manual offers remain usable during normal copy waits. Exclusive
buffer ownership reduces one decoder copy; fixed WASM scratch views are reused.
No-transfer fallback and canonical manifest snapshots avoid requiring structuredClone.
Measured memory is explicitly partial. See MOBILE_COMPATIBILITY.md for the trade-offs,
new automated scenarios and actual iOS/Android tests still NOT TESTED.
