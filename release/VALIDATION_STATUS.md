# Validation status

## Current M8 validation

Desktop-only automated results: JavaScript 76 passed; Python model 65 passed;
HTTPS helper 3 passed; backend golden runs 21 passed; WebRTC scenarios 13 passed;
offline/QR scenarios 12 passed directly against release/demo with the asset server
stopped during offline reload/inference; new desktop lifecycle/resource scenarios
13 passed; release-integrity/rollback tests 6 passed; typecheck/build/integrity passed.
Synthetic visibility/freeze/timer/camera failures and actual desktop Worker termination
are NOT physical screen-lock or Android/iOS evidence. Previous releases are preserved
in release-archives/. All six physical statuses below remain NOT TESTED.

## Historical M7 validation

M7 automated checks actually executed (Apple M2/macOS arm64, Node 24.6.0,
Python 3.12.5/PyTorch 2.5.1/NumPy 2.1.3, desktop Chrome 156.0.8078.74):

| Check | Actual status |
|---|---|
| npm ci from package-lock, install scripts disabled | PASS; 5 packages installed, audit 0 vulnerabilities |
| Python model tests, hashes/reconstruction | PASS; 65 tests |
| JavaScript inference/protocol/distributed tests | PASS; 67 tests |
| HTTPS helper tests | PASS; 3 tests |
| TypeScript checks / demo build | PASS |
| Browser backend golden runs | PASS; 21 runs |
| Real WebRTC scenarios | PASS; 13 scenarios /7 golden cases |
| Offline/QR/dashboard/M6 scenarios | PASS; 12 scenarios |
| Release integrity and corruption rejection | PASS; 5 tests |
| Temporary seed-42 weight/shard/golden regeneration | PASS; all byte-identical, originals unchanged |
| Two independent clean TS/demo builds | PASS; byte-identical clean-release inventories |
| Trusted local HTTPS delivery of release HTML/Worker/shards/WASM/service worker | PASS; HTTP 200 and expected sizes/types |
| Release verification | PASS; pinned shards, FP32, 11,040,768 params, WASM, Worker, shell and docs |

All M6 baseline suites remain passing with unchanged counts. No new mobile
performance number is presented. Earlier M6 desktop benchmark samples remain in
source artifacts/reports and must retain their original scope/environment.
Desktop evidence must never be relabeled as physical-mobile evidence.

| Deferred physical test | Status |
|---|---|
| iPhone Safari camera scanning | NOT TESTED |
| Android Chrome camera scanning | NOT TESTED |
| Offline reload on both phones | NOT TESTED |
| Screen-lock recovery | NOT TESTED |
| Interrupted-download recovery | NOT TESTED |
| Mobile performance benchmarks | NOT TESTED |

The user previously reported successful physical two-phone M4 inference. That is
historical user evidence only and does not change any status above. Follow
`docs/PHYSICAL_DEVICE_VALIDATION.md` and capture actual device exports before
recording a physical PASS. Operator JSON classifications are not automatic proof.

Expected Hello/8 byte IDs: [63,119,179,184,253,37,243,172]. The model is untrained.
