# miniMol Milestone 6 engineering report

Historical M6 results: later regression executions may refresh legacy artifact
paths referenced below. M7 captures separately tagged evidence; this table retains
the measurements actually observed during M6, not newly measured mobile results.

Build **729a7034b4acbdf2**. Existing M5 architecture preserved; no model, shard, CPU math,
protocol schema or peer-routing changes. Git inspection returned "not a git
repository"; no Git status/diff is available and no repository was initialized.

## Implemented

- Device validation panel: ten named scenarios with expectations, NOT TESTED
  defaults, operator PASS/FAIL with mandatory observations, timestamps, browser
  metadata, environment classification and downloadable JSON. QR, shard-loading,
  cache/offline and error observations are collected in a bounded 100-event log.
- Reload-after-pairing marker and visibility/resume observations. These expose
  recovery state and retain the established fresh-pairing policy. Visibility does
  not prove screen lock. Phone-specific scanner tests require actual phones.
- Dashboard backend, peer state, channel state, last error and participation.
  Phone 1 reports completed acknowledged two-runtime exchanges; Phone 2 reports
  processed peer activations. Owned layers are checked in traces before display.
- Worker instrumentation: model load/verification/backend setup time; prefill to
  first byte (includes START); per-position local/remote compute and exchange RTT;
  generation total and throughput; unchanged KV stats. No extra wire fields.
- In-app benchmark: Hello/8, two warmups, five measured runs, exact canonical byte
  comparison each run and JSON export. Do not generate concurrently. New runs
  reset output display; failure never enables an unready/stale session.
- Desktop CPU suite extended with shard read/verify, per-position/prefill timings,
  process memory and KV allocation. Transport is explicitly absent in this suite.
- All four requested final-demo/physical-validation/architecture/judge documents.

## Executed checks

| Command | Actual result |
|---|---|
| `npm test` | 67 passed, 0 failed/skipped, 33.277 seconds |
| `bash scripts/test-model.sh` | 65 passed in 4.39 s; weights/reconstruction verified |
| `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server` | 3 passed |
| `npm run typecheck` | passed |
| `npm run build:demo` | passed; demo-dist generated |
| `npm run test:browser` | 21 golden runs passed: seven each TS/scalar WASM/SIMD |
| `npm run test:webrtc` | 13 scenarios passed; seven golden cases, real DataChannel |
| `npm run test:milestone5` and final `node scripts/test-milestone5.mjs` | 12 scenarios passed: original 10 plus M6 real-pair benchmark/dashboard and paired-tab reload validation |
| `npm run benchmark:cpu` | all three CPU backends measured successfully |

The new unit test checks physical scenarios start NOT TESTED and require actual
observations for PASS/FAIL, rejecting unknown scenarios/statuses and bounding logs.
The new browser scenario exercises the visible benchmark UI: opens the collapsed
panel, selects DESKTOP, runs 2+5 generations, checks canonical bytes each run,
12 position timings, nonnegative compute/RTT and actual backend/load values.
A paired-tab reload regression also verifies the actual persisted reload observation,
peer closure and disabled Generate button before fresh pairing.
The first browser attempt timed out because the test did not open the collapsed
panel; that test was corrected before recording a passing run. A stricter reload assertion then caught a UI refresh bug: the persisted event
was logged but not immediately rendered. An initial render after restoring the
event fixes it; the final test asserts the actual observation text and passes.
No tests removed.

Original regressions continue to verify partition ownership, exact activation
frames, per-step layer participation, KV progression, golden activations/logits,
invalid-message rejection, concurrent-generation guard, timeout/interruption,
manual/direct-IP pairing and reconnect. No six-layer fallback was introduced.
M5 tests still verify role-only disk caches, corrupt-entry rejection/repair,
truncated downloads, quota failure, real mobile-size QR image decoding and cached
reload with zero HTTP requests reaching the asset host. Physical camera scanning
and physical offline operation are not implied by these browser tests.

## Measured performance — DESKTOP ONLY

Host Apple M2, macOS kernel 25.6.0, arm64, Node v24.6.0. Desktop browser Chrome
156.0.8078.74 uses two independent contexts/Workers on the same Mac with a REAL
DataChannel. No physical mobile benchmark was run. The final CPU and browser
benchmark captures were taken separately from other regression suites. Scheduling,
thermal state and browser timers still affect results; raw samples are retained.

| Local Node CPU, Hello/32, 2 warmups +5 runs | Mean total | Bytes/s at mean |
|---|---:|---:|
| TypeScript scalar | 355.39 ms | 90.04 |
| WASM scalar | 134.34 ms | 238.19 |
| WASM SIMD | 86.59 ms | 369.56 |

Local file read+verification: Phone 1 125.52 ms; Phone 2 79.31 ms (concurrent loads).
These values are local filesystem measurements, not phone download times. The
suite checks backend agreement and the first eight canonical Hello IDs; separate
golden regression tests cover the complete original fixture sequences.

Real desktop DataChannel pair, automatic SIMD backend, Hello/8, 2 warmups +5 runs:

- Mean generation total: **36.78 ms**; mean per-run rate **219.08 bytes/s**.
- Mean prefill-to-first-byte: **15.00 ms**.
- Mean per-position exchange RTT: **1.850 ms**; includes remote computation.
- Mean RTT minus reported remote compute: **0.657 ms**, including queue,
  serialization and scheduler overhead. NOT pure network/one-way transfer latency.
- Browser role load+verification+backend setup: **129.30 ms** A,
  **129.90 ms** B, using local loopback asset serving.
- Each role: 4,718,592 KV bytes allocated; Hello/8 occupies 110,592 bytes after
  12 positions. Optional page JS heap snapshot: 9955625 bytes;
  this is not total Worker/WASM/process/device RAM. Node process memory samples
  are separately recorded. No full mobile memory measurement is available.

The local CPU workload generates 32 bytes; browser workload generates 8. Do not
use these different workloads to claim relative transport overhead or speedup.
Physical mobile throughput, pure one-way latency and memory remain NOT TESTED.

## Files created

- src/demo/validation.ts — expectations, bounded observation log and result validation.
- src/demo/readiness.ts — device evidence export, lifecycle diagnostics, live
  participation/backend state and real-pair benchmark UI.
- tests/networking/validation.test.mjs — result/evidence regression.
- docs/FINAL_DEMO_GUIDE.md
- docs/PHYSICAL_DEVICE_VALIDATION.md
- docs/ARCHITECTURE_AND_LIMITATIONS.md
- docs/JUDGE_PRESENTATION.md
- MILESTONE_6_REPORT.md

## Files modified

- src/workers/distributed.worker.ts — measured load and generation timing metadata.
- demo/index.html — validation/benchmark controls, backend/connection/participation
  cards, last-error display and reusable benchmark output reset hooks.
- scripts/benchmark-inference.mjs — reproducible additional desktop measurements;
  keeps existing benchmark output and additionally writes M6 JSON.
- scripts/test-milestone5.mjs — additional benchmark/UI assertions and real browser
  measurements, without removing previous offline/QR scenarios.
- README.md, ENGINEERING_REPORT.md — pointers to current scope and final guides.

Raw evidence: artifacts/reports/milestone6-js.txt, milestone6-model.txt,
milestone6-desktop-benchmark.json, milestone6-webrtc-benchmark.json,
milestone4-webrtc.json, milestone5-browser.json and milestone2-browser.json.

## Limits and required physical work

All new iOS Safari/Android Chrome tests remain NOT TESTED until performed on the
actual phones with exported evidence. Prior successful physical M4 execution is
user-reported and is not expanded into unobserved M6 success. Use the physical
checklist for camera/chunks/denials, cache/download recovery, WAN-off cached reload,
paired tab reload, screen lock/resume, disconnect/reconnect and benchmarks.

Browser storage can be evicted or denied; private mode may restrict it. The
navigator online signal describes browser connectivity, not verified WAN reachability.
Camera detection/lighting, client-isolated Wi-Fi, browser suspension and local
network permissions remain risks. Fresh pairing is required after uncertain
failure; no automatic session/KV continuation is claimed. Interface timing is
subject to browser precision; no cross-device absolute timestamps are compared.
The model is untrained and output bytes are not meaningful English. No physical
mobile compatibility, final hackathon completion or pure network-latency claim.

## Next commands

```bash
cd /Users/vikrantsaini/Documents/miniMol
npm ci
npm run build:demo
python3 -B scripts/serve-demo.py \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop the existing server first. Open the Mac's trusted HTTPS URL directly in both
phone browsers, load different roles, prepare offline shell, confirm each phone's
own IP and pair. Follow docs/FINAL_DEMO_GUIDE.md, record the checklist and export
JSON from both phones. Run the real-pair benchmark on Phone 1 after connection.
