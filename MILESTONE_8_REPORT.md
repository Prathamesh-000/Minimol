# miniMol M8 — mobile reliability report

Release build **3ea2b4799bb63e66**. Existing architecture, exact 11,040,768 FP32
parameters, shapes, layer assignments, protocol and direct WebRTC are preserved.
No Git repository exists. Physical iPhone/Android validation remains NOT TESTED.

## Problems found and fixed

- Active sessions previously relied on generic timeout/connection events after
  backgrounding. Hidden/freeze/pagehide now invalidate active work immediately
  when delivered, and an elapsed-clock watchdog catches stale execution on return.
  Pending manual offers remain valid while copying; both pages must be foregrounded
  when the DataChannel opens. There is no promise to run while suspended.
- Added main-thread duplicate-generation prevention, bounded pending RPC count,
  clearer command deadlines, Worker error/message-error/delivery-failure handling
  and early cleanup after failed model loads. Constructor failure closes the peer.
- Worker message-error property assignment did not respond to the browser event
  in the new test. An explicit EventTarget listener fixes it and is removed on close.
- Shutdown removes lifecycle, Worker and transport handlers, heartbeat/watchdog/
  drain timers, rejects RPCs, closes queued sends and terminates the Worker. Late
  callbacks cannot emit results after closure. Restart creates fresh KV state.
- ICE state monitoring complements connection/channel monitoring. A 100-ms polling
  fallback drains backpressure when a browser misses bufferedamountlow; existing
  immutable queues, size checks, correlation and stale/duplicate rejection remain.
- Camera tracks now stop on retry/disconnect. Stale asynchronous permission
  rejections after Stop are ignored; closed sessions cannot create fresh QR codes
  or request camera unnecessarily. Manual text and QR pairing remain available.
- Exclusive fetch/cache buffers transfer ownership before verification, avoiding
  one whole-shard decoder copy where supported. Default decoder still snapshots
  retained aliases; old/no-transfer environments retain safe copy fallback.
- A pre-existing unconditional structuredClone manifest dependency prevented that
  fallback. Canonical validated snapshots now avoid the API and untrusted toJSON
  hooks. Cache snapshots still commit ONLY after complete integrity verification.
- Fixed WASM input/output views are reused. Role-local WASM copies remain necessary;
  no quantization, FP32 arithmetic change, kernel change or unsafe buffer release.
- Dashboard adds API/probe results, actual backend/fallback details, WASM linear
  allocation, optional reported page heap, load/prefill times, buffered bytes,
  lifecycle and recovery. Unavailable metrics say unavailable; no total-RAM claim.

## Implemented recovery policy

Active inference or an open verified channel is discarded on lifecycle uncertainty;
no KV continuation is attempted. Load / retry BOTH roles and exchange fresh SDP.
Manual offer waiting is not treated as an execution gap. A separate regular
watchdog and connection-time clock reset avoid expiring long manual exchanges.
Control RPCs have 8-s bounds, attach 20 s, load 120 s, whole generation 180 s;
existing protocol per-activation/liveness timeouts still apply. Silent OS termination
cannot always be observed until JS resumes and a command/heartbeat deadline fires.
A generation canceled by Stop/disconnect fails safely; no local full-model fallback.

## Actual executed tests

Environment: Apple M2/macOS arm64, Node 24.6.0, TypeScript 5.7.3, Python 3.12.5,
PyTorch 2.5.1, NumPy 2.1.3, desktop Chrome 156.0.8078.74.

| Command | Result |
|---|---|
| `npm test` | **76 passed**, 0 failures/skips, 31.256 s; M7's 67 plus 9 new cases |
| `bash scripts/test-model.sh` | **65 passed**, 6.08 s; original hashes/reconstruction |
| `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server` | **3 passed** |
| `npm run typecheck` / `npm run build:demo` | passed |
| `npm run test:webrtc` | **13 scenarios**, all 7 golden prompts passed |
| `npm run test:browser` | **21 golden runs** passed across TS/scalar WASM/SIMD |
| `MINIMOL_REPORT_TAG=milestone8 node scripts/test-milestone5.mjs` | **12 offline/QR/dashboard/reload scenarios passed** |
| `node scripts/test-mobile-reliability.mjs` | **13 new desktop reliability scenarios passed** |
| `MINIMOL_DEMO_DIR=release/demo MINIMOL_REPORT_TAG=milestone8-release node scripts/test-milestone5.mjs` | **12 passed** directly against final release; HTTP asset server stopped during offline tests |
| `npm run test:release` | **6 passed**, including idempotent archival and protection of changed backups |
| `npm run release:build` and release verifier | passed, 94 inventoried files /41 shell assets |
| final `model.verify_weights` | exact parameter count, FP32 and both canonical shards verified |

New Node cases exercise manual-vs-active lifecycle, stale clock gaps, listener
cleanup, missing drain events, invalid binary/startup overflow, transfer and
no-transfer ownership, repeated engine load/dispose, safe manifest snapshots and
WASM allocation failure to real TypeScript fallback. New browser cases exercise
synthetic hidden/freeze/resume, actual interrupted inference and duplicate requests,
actual Worker termination/deadline/restart, three role reload/unload cycles, malformed
binary DataChannel frames, fresh reconnection/canonical bytes, message-error events,
postMessage failure cleanup and delayed camera-request cancellation.

These are desktop/synthetic transitions, NOT actual device locks or Android/iOS
memory-pressure evidence. Cleanup asserts stopped execution/timers/listeners/RPCs;
GC/RSS release is browser-managed and not falsely asserted. Memory saving is a
structural eliminated copy, not an invented measured mobile RAM reduction.

## Test failures resolved / limits of evidence

Initial tests caught a manual-wait clock false positive and the missing no-transfer
manifest fallback. Both were corrected without weakening assertions. A stricter
Worker message-error test caught the event-handler registration issue described
above. An offline test exposed a browser-internal service-worker update request bypassing
HTTP interception. The harness now waits for setup idle and actually stops the
asset server during offline reload/inference, then restores it for repair tests.
The zero-HTTP assertion remains unchanged; browsers may still attempt update checks.
One concurrent browser run failed an asset fetch; an isolated diagnostic rerun
passed. Its exact environmental cause was not established. No assertion was removed.

## Release and rollback

M7 is preserved and independently verified at:
`release-archives/9f5153c5b7effc98-172521168966/`.
The packager now archives each previous verified release before replacement and
refuses to overwrite changed archives. Archives are outside the HTTPS root.
Both model shard hashes and canonical reconstruction remain unchanged. Release
manifest/checksums are regenerated; all six deferred physical fields remain NOT TESTED.

## Files created

- src/demo/lifecycle.ts
- src/demo/capabilities.ts
- scripts/test-mobile-reliability.mjs
- scripts/archive-release.mjs
- tests/networking/lifecycle.test.mjs
- tests/networking/webrtcAdapter.test.mjs
- docs/MOBILE_COMPATIBILITY.md
- MILESTONE_8_REPORT.md and generated release/archive artifacts

## Files modified

- src/demo/session.ts, readiness.ts, dashboard.ts; demo/index.html
- src/networking/pairing.ts, webrtcTransport.ts
- src/inference/weightLoader.ts, modelManifest.ts, wasmBackend.ts, matrixMultiply.ts,
  roleEngine.ts; src/offline/shardCache.ts; src/workers/distributed.worker.ts
- tests/inference/loader.test.mjs, wasm.test.mjs; tests/release/integrity.test.mjs
- scripts/package-release.mjs, test-milestone5.mjs, test-webrtc.mjs
- package.json, .gitignore, final demo/limitations docs and release-content templates
- README.md and ENGINEERING_REPORT.md release pointers

## Physical work remaining

All actual iPhone Safari/Android Chrome camera, cold offline reload, screen lock,
interrupted download and mobile performance checks remain NOT TESTED. Test real
foreground/background/app-switch/lock/resume, repeated generation and recovery
with both device dashboards and exported evidence. API presence is not certification.
See docs/MOBILE_COMPATIBILITY.md and docs/PHYSICAL_DEVICE_VALIDATION.md.

## Next commands

```bash
cd /Users/vikrantsaini/Documents/miniMol
npm run build:demo
npm run test:mobile
npm run release:build
npm run release:verify
python3 -B scripts/serve-demo.py --directory release/demo \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop the old port-8443 server first. Open the trusted Mac HTTPS URL on both phones,
load different roles, prepare offline assets and pair with BOTH pages foregrounded.
Generate Hello/8 and verify [63,119,179,184,253,37,243,172]. After background/lock/
uncertain failure, Load / retry BOTH and pair freshly. No suspended inference promise.
