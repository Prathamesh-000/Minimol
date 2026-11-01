# miniMol M7 — release engineering report

Release build **9f5153c5b7effc98**, development build **729a7034b4acbdf2**.
The different IDs reflect release-only omission of debugging source-map comments;
model, protocol and runtime behavior are unchanged. No Git repository exists in
this directory; no new repository/project was created.

## Release audit and fixes

Reviewed model contract/exports, TypeScript and scalar/SIMD WASM math, ownership,
KV caches, local/distributed coordinators, protocol/transport, QR/manual pairing,
cache recovery, dashboard and benchmarks against M1–M6 reports and tests.

- Ordinary demo builds accumulate asset versions and can retain stale output.
  Release builds now compile into empty temporary storage and build a fresh bundle.
  The verifier rejects stale asset versions. Working demo-dist is not deleted.
- Release-only compilation omits .map/.d.ts files and sourceMappingURL comments,
  preventing developer source paths from being published; development debugging
  output is retained. The staged release is directly browser-tested.
- Added complete artifact inventories, checksums and canonical pins. A build ID
  alone previously did not cover all model/WASM/static file contents.
- Hardened the NEW release verifier before finalizing it: it reads schema data
  from trusted source, never executes package JavaScript, and checks approved WASM
  hashes before instantiation. A negative test confirms altered JS is not executed.
- Added safe model regeneration/reproducibility checks that never overwrite the
  originals, plus independent clean compilation comparisons.
- Added HTTPS helper selection restricted to demo-dist or release/demo; serving
  the repository or private keys is not an allowed directory option.
- Legacy report paths can be refreshed by later test runs. Added optional M7
  report namespacing and documented historical M6 tables versus latest-run files.
- Local/distributed coordinators, legacy Worker APIs and compatibility dist copies
  are intentional reference/backward-compatibility code. They were retained.
  No unused npm dependency found: TypeScript and Playwright are build/test tools;
  jsQR and qrcode-generator are locally bundled runtime assets.
- Historical documentation states are identified as such. Release documents give
  current capabilities and explicitly defer all six physical checks.

A syntax typo in the newly added integrity test was corrected before execution.
No original test was removed or weakened. No application inference/pairing code
was rewritten. Cache/suspension/network limitations remain documented rather than
being falsely described as solved. See release/AUDIT.md for detailed findings.

## Model integrity and reproducibility

Existing artifacts were verified before any regeneration audit. Seed-42 generation
ran in a TemporaryDirectory with pinned PyTorch 2.5.1/NumPy 2.1.3, deterministic
algorithms and one CPU thread. Full weights, both shards and golden-vector JSON
were byte-identical. Original files remained unchanged. Manifest architecture,
ownership and offsets matched; descriptive host metadata is not promised identical
across machines. Exact hashes:

- Full, 44,163,072 bytes /11,040,768 parameters:
  0b47c07669cbe9d6ac70d52ea0385e035feb4c3d3879896a4aab9788ae4a692c
- Phone 1, 22,473,216 bytes /5,618,304 parameters:
  582f266866d34f17f081161ff196043ea9ceb0b1d09e0daf034ad0e0f2de22e6
- Phone 2, 21,689,856 bytes /5,422,464 parameters:
  50a4e8ccc29188b78542957d3705669929dc2e4caf2e334a52622f074c2667f2

Both shards concatenate to the canonical full hash. Release verification checks
FP32 little-endian/finiteness, tensor schema/ownership/counts against trusted source,
actual sizes and independent pinned hashes. Full weights are never packaged.

`npm ci --cache /private/tmp/minimol-npm-cache --ignore-scripts` succeeded: five
packages installed and zero npm vulnerabilities reported. The first sandboxed
network attempt was canceled; the network-permitted invocation passed. Python's
installed pinned environment passed pip check and actual regeneration; a fresh
Python dependency download on another OS was not performed or claimed.

Two independent empty TS compilations/demo builds produced byte-identical
89-file release inventories with the same build ID. No timestamp/random temp path
is embedded in the release manifest. Same pinned toolchain/environment is the
reproducibility scope; cross-platform compiler equivalence is not guaranteed.

## Exact executed tests and comparison with M6

Environment: Apple M2/macOS arm64, Node 24.6.0, TypeScript 5.7.3,
Python 3.12.5, PyTorch 2.5.1, NumPy 2.1.3, desktop Chrome 156.0.8078.74.

| Executed command/check | Actual result | M6 comparison |
|---|---|---|
| `npm test` | 67 passed, zero failures/skips; 31.724 s | same 67 |
| `bash scripts/test-model.sh` | 65 passed in 4.35 s; hashes/reconstruction verified | same 65 |
| `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server` | 3 passed | same 3 |
| `npm run typecheck` | passed | passed |
| `npm run test:webrtc` | 13 scenarios /7 golden cases passed | same 13 |
| `npm run test:browser` | 21 golden runs, 7 per TS/scalar/SIMD backend | same 21 |
| `npm run test:milestone5` | 12 offline/QR/dashboard/reload scenarios passed | same 12 |
| `MINIMOL_DEMO_DIR=release/demo MINIMOL_REPORT_TAG=milestone7 node scripts/test-milestone5.mjs` | 12 passed directly against release bundle | new package validation |
| `npm run test:release` | 5 passed: clean package, corruption, missing/extra assets, fake checksums/mobile PASS, untrusted-JS non-execution | new |
| `npm run release:build` | generated verified release | new |
| `npm run release:verify` | passed | new |
| `.venv/bin/python -B scripts/reproduce-model.py` | byte-identical weights/shards/goldens; originals unchanged | new script |
| `npm run reproduce:build` | two independent clean builds identical | new script |
| Trusted HTTPS release smoke | HTML GET and Worker/shards/WASM/SW HEAD returned 200 with correct MIME/sizes | new package validation |

The existing suites still check assigned-only layers and weight ownership,
independent caches, actual activation/prediction/logit exchange, all canonical
outputs, malformed protocol/QR rejection, timeout/disconnect/reconnect, per-step
participation and offline corrupted/truncated/quota recovery. Packaging did not
change these contracts. No desktop result is a physical-device PASS.

## Security and privacy

No cloud inference, external ICE server, TURN, signaling service, analytics or
activation relay found in application source or introduced. Fetches are for
same-origin assets and optional own-IP hint. Peer tensor traffic uses validated
binary messages over WebRTC. Runtime dependencies are bundled, camera is explicit
video-only, display/error text uses textContent, and model loads verify hashes.

HTTPS bootstrap and dependency installation require initial network access. Local
Wi-Fi remains required after caching. Host-only ICE can fail with client isolation,
blocked UDP/mDNS, permissions or suspension. No silent relay/full-model fallback.

SDP intentionally reveals local candidate information and ephemeral ICE data to
the chosen peer. Own-IP export and local Python HTTP logs expose addresses locally.
Diagnostic exports can include user agent, operator notes and test results; they
are downloaded locally and not included in the release. No private CA/server keys,
full model file, raw device export or source machine path maps are packaged.

Release checksums are unsigned corruption checks, not publisher authentication.
The verifier/source/HTTPS origin must be trusted. QR hash validates data, not human
identity. No penetration-test/formal security certification is claimed.

## Release contents and integrity

release/ includes all eight requested deliverables:
README.md, TECHNICAL_OVERVIEW.md, DEMO_SCRIPT.md, JUDGE_QA.md, LIMITATIONS.md,
RELEASE_MANIFEST.json, RELEASE_CHECKSUMS.txt and VALIDATION_STATUS.md.
It additionally includes AUDIT.md, four final-guide docs and the runnable demo/.

There are 89 inventoried payload files plus manifest/checksum controls. The manifest
lists size/SHA-256, build/toolchain/model metadata and all six NOT TESTED physical
statuses. Checksums cover every payload plus the manifest; only checksum self-hash
is excluded to avoid a circular digest. Symlinks, private/development artifacts,
stale asset versions, missing relative modules/assets, incorrect model schema or
weights, unapproved WASM, missing docs and inconsistent checksums are rejected.

Packaging validates before replacing an existing release. It refuses to overwrite
an already modified/invalid release; user additions must be reviewed separately.
Temporary staging is cleaned up, while original model files and demo-dist survive.

## Created/modified files

Created:
- scripts/package-release.mjs
- scripts/verify-release.mjs
- scripts/reproduce-model.py
- scripts/reproduce-build.mjs
- tests/release/integrity.test.mjs
- release-content/{README,TECHNICAL_OVERVIEW,DEMO_SCRIPT,JUDGE_QA,LIMITATIONS,VALIDATION_STATUS,AUDIT}.md
- generated release/ and MILESTONE_7_REPORT.md

Modified:
- scripts/build-demo.mjs: optional output/compiled directories and accurate output logging.
- scripts/serve-demo.py: restricted release/demo directory selection.
- scripts/test-milestone5.mjs: optional distribution root and tagged evidence paths.
- package.json: release/repro/integrity commands; dependency versions unchanged.
- README.md, ENGINEERING_REPORT.md: current release entry points.
- MILESTONE_6_REPORT.md: historical evidence-path clarification only.

No model binaries, golden vectors, runtime architecture or inference source changed.

## Physical status and remaining limitations

DELIBERATELY NOT TESTED: iPhone Safari camera; Android Chrome camera; offline reload
on both phones; screen-lock recovery; interrupted-download recovery; mobile
performance benchmarks. Only the user may replace these with captured actual
phone observations. Historical user-reported M4 success does not change them.

Untrained output is arbitrary bytes, not meaningful English. Context remains 512,
only one exchange is in flight, interrupted downloads restart, browser storage may
be evicted/denied and uncertain sessions need fresh pairing. Development Python
server is not hardened public hosting. A project-wide license was not selected on
the owner's behalf; upstream QR license notices are included. See release/LIMITATIONS.md.

## Final commands

```bash
cd /Users/vikrantsaini/Documents/miniMol
npm ci --ignore-scripts
npm run reproduce:model
npm run reproduce:build
npm run release:build
npm run release:verify
npm run test:release
python3 -B scripts/serve-demo.py --directory release/demo \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop the previous port-8443 server first. Open the Mac's trusted HTTPS URL directly
on both phones and confirm release build 9f5153c5b7effc98. Follow release/DEMO_SCRIPT.md
and docs/PHYSICAL_DEVICE_VALIDATION.md. Clean machines need the Python environment
and initial weight generation described in release/README.md; reproduce:model
requires existing verified originals and never overwrites them.

Evidence files: artifacts/reports/milestone7-initial-weights.json,
milestone7-reproducibility.json, milestone7-build-reproducibility.json,
milestone7-js.txt, milestone7-model.txt, milestone7-release-tests.txt,
milestone7-release-integrity.json, milestone7-https.json,
milestone7-offline-qr.json and milestone7-webrtc-benchmark.json. Legacy M4/M2
browser report files also contain the latest executed regression results.
