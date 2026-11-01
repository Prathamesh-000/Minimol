# Judge Q&A

**Does it generate useful English?** No. The fixed seed-42 model is untrained.
Exact golden bytes demonstrate correct distributed math, not language capability.

**Why two phones?** To demonstrate model partitioning, separate memory/KV ownership
and CPU work, with neither phone holding/executing all six layers.

**What travels over the network?** Actual 384-FP32 hidden activations (1536-byte
payload plus header) and predicted byte responses. Debug mode can return logits.
Raw shard weights are fetched only from the initial trusted static host, never
transferred to the peer through the inference protocol.

**Where is inference?** Inside independent browser Workers using scalar TypeScript
or optional C++ scalar/SIMD WASM linear kernels. There is no cloud inference.

**How do you pair without a server?** Completed SDP offer/answer text or locally
bundled multi-chunk QR exchange. Connection uses empty ICE servers and verifies a
host/host path. No TURN/STUN/external signaling service or activation relay.

**How do judges verify participation?** Show assigned layers, both per-role counters,
network traffic and KV position. Disconnect Phone 2: Phone 1 must fail safely.
Fresh pairing restores canonical output. Automated tests check every layer trace.

**What does KV caching do?** Retains previously computed keys/values separately for
each phone's three layers, avoiding recomputation of the entire prefix per byte.
Each phone allocates 4,718,592 bytes for context up to 512 positions.

**Does offline mean no network?** No. After shell/assigned shard caching, no Internet
or asset server is needed on supported configurations; direct local Wi-Fi remains
necessary. Desktop cached reload/inference is tested; physical offline is NOT TESTED.

**Are mobile speed figures available?** No. Only labeled desktop CPU and real
DataChannel-on-one-Mac measurements exist. Use both phones to record mobile samples.

**Is it secure?** HTTPS bootstrap and WebRTC DTLS protect transport. Strict bounded
message validation, cache SHA-256 and release checksums detect corruption. QR hash
is not human identity verification; release checksums are unsigned. Trust the
source/HTTPS host and exchange pairing data with the intended peer.

**Why can pairing fail?** Host-only ICE can fail with isolated Wi-Fi, blocked UDP,
mDNS filtering, permission restrictions or browser suspension. Numeric own-phone
IP export can avoid mDNS. There is deliberately no centralized fallback.
