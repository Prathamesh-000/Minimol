# Judge presentation

## Problem

A single phone has limited compute and memory. Can two mobile browsers cooperate
on one reproducible neural-network computation without an inference server?

## Solution and technical innovation

miniMol partitions an exact 11,040,768-parameter Transformer across two phones.
Phone 1 computes embeddings/0–2; Phone 2 computes 3–5/final norm/output. Each keeps
its own KV cache. Every predicted byte requires real activation/prediction exchange
through a versioned, validated direct WebRTC DataChannel. CPU-only execution uses
JavaScript plus optional C++ scalar/SIMD WASM. No cloud inference or relay is used.
Local QR/manual pairing and separately verified offline shell/shards support a
server-independent demo once cached, subject to actual network/browser capability.

## Live sequence (about three minutes)

1. Show both phones' roles, different layer assignments, backend and verified shard.
2. Pair with QR; mention manual text fallback. Show host path/channel and handshake.
3. Generate Hello /8 on Phone 1. Show both participation traces/counters advancing,
   network traffic, KV occupancy and exact output IDs.
4. Explain that the deterministic random model demonstrates distributed math,
   not meaningful English. Display [63,119,179,184,253,37,243,172].
5. Run real-pair benchmark (two warmups/five runs). Show measured timing and export
   both devices' evidence. Label physical mobile separately from desktop results.
6. If physically validated beforehand, stop the asset server, retain Wi-Fi and
   reload cached pages; pair again. Otherwise identify offline phone testing as pending.
7. Disconnect one peer to show safe failure, then reset/re-pair both for recovery.

## Measured results

See MILESTONE_6_REPORT.md and artifacts/reports/milestone6-*-benchmark.json for
actual environment, samples and results. Desktop Node results are two local role
engines without transport. Desktop Chrome real-pair results are separate contexts
on one Mac with real DataChannel. Neither is physical mobile throughput.
Physical mobile performance is NOT TESTED until recorded on the actual phones.

## Limitations and future work

Untrained weights, 512-byte context, single in-flight exchange, cache eviction,
background suspension and isolated Wi-Fi are real limits. Future improvements
include full-engine WASM profiling, trained weights as a separately specified
project, easier optical pairing, physical-device coverage and measured batching.
Preserve exact current architecture/reference for this hackathon validation.
