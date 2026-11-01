# miniMol engineering reports

Latest: [M7 release engineering](MILESTONE_7_REPORT.md), with clean staging,
model/build reproducibility, release checksums and unchanged physical NOT TESTED status.

Latest: [M6 validation and performance](MILESTONE_6_REPORT.md). Physical M6
checks remain NOT TESTED; execute the device checklist and export evidence.

**Latest: [Milestone 5](MILESTONE_5_REPORT.md)** — verified offline/cache, QR-image
pairing and responsive dashboard in desktop Chrome. Physical M4 success was
reported by the user; new M5 physical camera/offline validation remains pending.
The following M1–M4 sections are historical reports.

**Historical M1–M4 status: Milestones 1–3 and desktop-browser M4 were verified.** Read the
[Milestone 4 report](MILESTONE_4_REPORT.md) for real WebRTC, static demo instructions
and physical-device limitations. Read the
[Milestone 3 report](MILESTONE_3_REPORT.md) for the protocol and isolated-process
results. Read the
[Milestone 2 report](MILESTONE_2_REPORT.md) for CPU engines, independent KV caches,
isolated Workers, real Chrome tests, C++ WASM/SIMD acceleration and measured desktop
performance. The original React migration remains deferred. M5 now supplies offline support
and a responsive HTML/TypeScript dashboard; physical M5 validation remains pending.

## Milestone 1 report (historical accepted baseline)

Recorded 1 November 2026 (Asia/Kolkata). **Milestone 1 is complete; the entire
two-phone application is not complete.** No browser or physical-device result is
claimed here.

## Implemented

- Exact six-block pre-LayerNorm causal Transformer in PyTorch, CPU FP32, with
  seeded default initialization in the required module construction order.
- Immutable validated model configuration and independent 77-tensor shape/order
  schema; exact GELU, fused QKV, six heads, all required biases and untied head.
- Canonical weight generation, independent re-export, two role shards, private
  and public JSON manifests, little-endian serialization, exact byte offsets,
  ownership and SHA-256 verification.
- Corruption rejection for hashes, truncated files, NaN/Inf weights, shape/order/
  ownership/offset/config tampering, unsafe file names and invalid boundary tensors.
- Development-only role loaders that open just their assigned shard. Tests put
  each shard in a separate directory where the other shard/full file is absent.
- Seven golden cases with activations/logits/greedy IDs and autoregressive bytes;
  setup/verification scripts, pinned dependencies, architecture and milestone docs.

## Executed test results

Environment: macOS arm64, Python 3.12.5, PyTorch 2.5.1, NumPy 2.1.3, pytest 8.3.4.
The reference uses CPU, one compute thread and deterministic algorithms.

| Command/check | Actual result |
| --- | --- |
| `bash scripts/build-model.sh` | Export and verification succeeded; seven golden cases generated |
| `bash scripts/test-model.sh` | **65 passed in 4.17s**, exit 0; full verification succeeded |
| `bash scripts/verify-model.sh --public-only` | Both public shards verified, exit 0 |
| `.venv/bin/python -m pip check` | No broken requirements found |
| Fresh Python process, separate temporary output directories | All three weight binaries, both manifests and golden JSON were byte-identical |
| Full reference vs separately reloaded shard modules | Maximum absolute activation error **0.0** and logit error **0.0** for all seven cases / **553 positions**; every greedy ID identical |
| Short autoregressive golden sequences | All seven cases match, including the one valid prediction from a full 512-byte context |

Raw evidence:

- [pytest console output](artifacts/reports/model-tests.txt)
- [JUnit results](artifacts/reports/model-tests.xml)
- [Weight verification JSON](artifacts/reports/weight-verification.json)
- [Fresh-process and per-case split results](artifacts/reports/reproducibility-and-split.json)

An additional ad hoc harness initially spawned a Torch process from a parent that
had already imported Torch. That child aborted with `OMP: Error #179: Function
Can't open SHM failed`. A minimal nested-import experiment reproduced it. The
documented shell commands and a clean standard-library parent succeeded; the
fresh-process comparison above completed before importing Torch in its parent.
This local nested-process OpenMP issue is not a passing test and is not hidden by
the successful model suite. No OpenMP safety checks were disabled.

## Exact parameter and file verification

| Component/file | Parameters | Bytes |
| --- | ---: | ---: |
| Token embeddings | 98,304 | 393,216 |
| Position embeddings | 196,608 | 786,432 |
| Each of six blocks | 1,774,464 | 7,097,856 |
| Final LayerNorm | 768 | 3,072 |
| Untied output head | 98,304 | 393,216 |
| **Canonical full model** | **11,040,768** | **44,163,072** |
| **Phone 1 shard** | **5,618,304** | **22,473,216** |
| **Phone 2 shard** | **5,422,464** | **21,689,856** |

All values are finite FP32. Both shards concatenate to the canonical file exactly.
There are no padding gaps or duplicate/omitted tensors. The public manifest has no
full-file entry and `public/model/weights.bin` does not exist.

SHA-256, as actually generated and verified:

```text
weights.bin
0b47c07669cbe9d6ac70d52ea0385e035feb4c3d3879896a4aab9788ae4a692c

phone1.bin
582f266866d34f17f081161ff196043ea9ceb0b1d09e0daf034ad0e0f2de22e6

phone2.bin
50a4e8ccc29188b78542957d3705669929dc2e4caf2e334a52622f074c2667f2

model configuration (canonical sorted compact JSON)
307401b815cf19d2919b799f793a46e810a3bd2857f5da1abf661c4476c390ec
```

## Limits and pending work

The split checks are development PyTorch module checks. They do **not** implement
or prove the M3 isolated production-runtime binary protocol, WebRTC transport, or
two physical phones. The full-prefix autoregressive oracle intentionally has no
KV cache; M2 must implement incremental per-role caches and compare against it.

At the end of M1, Milestones 2–8 remained pending: scalar TypeScript CPU engine, KV caches, two-runtime
simulation, versioned binary protocol, direct host-only WebRTC, bundled QR/manual
signaling, Workers and React UI, role-only browser loading, Service Worker/offline
storage, WASM/SIMD, actual benchmarks, mobile compatibility trials and static HTTPS
deployment. The M2 report above records subsequent progress and desktop CPU
measurements. Network latency/mobile performance remain unmeasured. The M1
test-suite duration above is not an inference benchmark.

The weights are untrained by specification; output need not be meaningful text.
The same-environment reproducibility result does not promise bit-for-bit floating
point equivalence across PyTorch versions, browser engines, SIMD implementations
or devices. Cross-engine tolerances remain `atol=1e-4, rtol=1e-4`, with exact greedy
ID agreement required. Host-only ICE compatibility, cache eviction, secure-context
bootstrap, UTF-8 output handling and mobile memory/CPU performance remain explicit
risks in SPEC_DECISIONS.md and required gates in TASKS.md.
