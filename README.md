# miniMol

Latest: [M8 mobile reliability](MILESTONE_8_REPORT.md) and
[mobile compatibility/recovery](docs/MOBILE_COMPATIBILITY.md). Active sessions
require both pages foregrounded; prior releases are archived for recovery.

Latest: [M7 release audit and exact results](MILESTONE_7_REPORT.md). Generate with
`npm run release:build`; verify with `npm run release:verify`. The judge package
is [release/README.md](release/README.md); all six deferred physical checks remain
NOT TESTED. See the report for deterministic model/build reproduction commands.

Latest: [M6 validation/performance report](MILESTONE_6_REPORT.md),
[final demo guide](docs/FINAL_DEMO_GUIDE.md),
[physical checklist](docs/PHYSICAL_DEVICE_VALIDATION.md),
[architecture and limits](docs/ARCHITECTURE_AND_LIMITATIONS.md),
[judge presentation](docs/JUDGE_PRESENTATION.md).

Two smartphones will cooperate to run one exact byte-level Transformer entirely
inside their browsers. Phone 1 owns embeddings and layers 0–2; Phone 2 owns layers
3–5, final LayerNorm, and the untied language-model head.

**Milestones 1–3 and desktop-browser M4 are verified.** The repository provides the exact PyTorch
reference, verified FP32 shards, golden vectors, browser CPU inference engines,
incremental KV caches, role-specific Workers, and optional C++ WebAssembly/SIMD
matrix acceleration, plus a versioned binary protocol and two-process distributed
simulation and real host-only WebRTC with manual pairing. M5 adds bundled QR scanning, a responsive dashboard and verified offline caching.
Remaining physical-device validation is tracked in [TASKS.md](TASKS.md). Python is development
tooling and never participates in browser inference.

## Milestone 5 — offline preparation, QR and dashboard

M5 is implemented and desktop-tested. See [MILESTONE_5_REPORT.md](MILESTONE_5_REPORT.md)
for exact tests, files, offline evidence and physical-phone instructions. The user
reported successful physical M4 inference; **new M5 camera/offline features have
not been validated on physical devices**.

Load the assigned role, then press **Prepare offline shell / retry** on each phone.
The cached shard is integrity-checked on every load. Each browser stores only its
selected role; changing roles clears the previous shard. Keep one role/tab per
browser. QR scanning fills the existing signaling text box: still press Create
answer or Apply answer after scanning every code. Manual/direct-IP pairing remains.

Run `npm run test:milestone5` for offline/QR/dashboard tests. When testing offline,
retain local Wi-Fi. Cached readiness is distinct from an actual offline reload.
See the report for safe service-worker updates and cache-eviction recovery.

## Run the real WebRTC demo (Milestone 4)

```bash
npm ci
npm run build:demo
npm run test:webrtc
```

Host only `demo-dist/` on trusted HTTPS and open the same URL on both phones.
Select different roles, load/verify each shard, then exchange the completed offer
and answer using the text boxes. Phone 1 generates after both peers complete the
model handshake and the selected ICE path is verified as direct host-to-host.
Keep screens awake on the same Wi-Fi or compatible hotspot. Disconnect and reload
both roles to retry with fresh signaling. No STUN/TURN or cloud signaling is used.

If pairing stalls after **Apply answer**, use **THIS phone's Wi-Fi IPv4** before
creating a fresh offer/answer on each device. Verify the address in the phone's
Wi-Fi settings; do not enter the Mac's address. This optional mode exports numeric
UDP host candidates instead of `.local` names. It avoids mDNS resolution but cannot
overcome Wi-Fi client isolation or blocked peer UDP. The updated local helper can
suggest the requesting phone's IP; a static host can use manual entry instead:

```bash
python3 -B scripts/serve-demo.py \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop the previous server with Ctrl+C before running this command. Open the URL
directly in the Safari/Chrome app, not inside a messaging/search app. Generation
is initiated **only on Phone 1**; Phone 2 stays in worker mode automatically.
For `Hello`, set **New bytes = 8**; expected IDs are
`[63,119,179,184,253,37,243,172]`. The weights are untrained, so readable prose is
not expected. See **Connection diagnostics** or **Copy connection diagnostics**
for ICE state, channel state, candidate counts and model-handshake readiness.

See [MILESTONE_4_REPORT.md](MILESTONE_4_REPORT.md) for exact instructions, tests,
file inventory and Safari/network risks. Only desktop Chrome has been tested;
physical iPhone/Android validation remains pending. M5 now includes offline caching and QR alongside manual pairing.
The existing HTML/TypeScript architecture was retained. Python is not needed on either phone.

## Run Milestone 3

```bash
npm run test:distributed
```

This builds the existing TypeScript code and executes protocol, backpressure,
failure/recovery and isolated-process tests. Each Node process gets only its role
shard in a separate temporary directory. Runtime A runs the coordinator and layers
0–2; Runtime B runs layers 3–5 and the output head. Actual binary activation and
byte-response frames cross process IPC. No full-model fallback exists. Tests
require the existing M1 weights and golden vectors. `npm test` now includes all
66 JavaScript tests including signaling/address handling, QR and byte metrics; Python model tests
remain `npm run test:model`. The HTTPS helper tests run separately with
`.venv/bin/python -B -m pytest -q tests/server`.

Read [PROTOCOL.md](PROTOCOL.md) and [MILESTONE_3_REPORT.md](MILESTONE_3_REPORT.md)
for the wire format, measured results, file inventory and limitations. The IPC
broker is development simulation infrastructure. Real browser WebRTC is covered
by the separate M4 demo; physical-phone validation remains pending.

## Run Milestone 2

Node 24.6.0 was used for build/tests. Runtime code is browser ES modules with
standard APIs and no runtime npm dependencies. Pinned npm packages are development
tools only. Generate M1 weights first if the binaries are absent.

```bash
npm ci
npm run build
bash scripts/test-inference.sh
npm run test:model
npm run test:browser
npm run benchmark:cpu
```

Inference tests use the existing M1 weights/golden fixture. Optional compiled WASM
binaries are in `public/wasm/`. The browser test launches installed Chrome with a
temporary profile and a loopback-only asset server. Set `MINIMOL_CHROME` to its
executable on another platform. Two browser contexts each run one role in a Worker.
The test driver relays activations locally; it is not WebRTC or a deployment
server. CPU benchmark results are desktop measurements, not mobile throughput.

To rebuild the C++ matrix kernels:

```bash
# Uses .tools/wasi-sdk-25.0-arm64-macos when present.
bash scripts/build-wasm.sh

# Or point at your own WASI SDK compiler.
MINIMOL_WASM_CXX=/absolute/path/to/wasi-sdk/bin/clang++ bash scripts/build-wasm.sh
```

The official WASI SDK 25 compiler is installed under ignored `.tools/` locally;
it is never shipped to phones. Without a compiler, use the included binaries or
the independent TypeScript fallback. The build script also recognizes Emscripten,
but that build route has not been tested here.

`Phone1Engine.step(byte, position)` returns 384 floats. `Phone2Engine.step(activation,
position)` returns a greedy byte/position; logits require explicit debug mode.
Both support `reset()`, `stats`, and `dispose()`. The generation coordinator
accepts a two-role transport instead of owning weights. Callers must serialize
generation sessions and await both verified role loads. The worker entrypoint
fixes its role in its URL and supports load/reset/step/stats/dispose requests.
`tests/browser/role.html` is a minimal usage example, not a production UI.

## Run Milestone 1

The recorded baseline is macOS arm64, Python 3.12.5, PyTorch 2.5.1, NumPy 2.1.3.
Use Python 3.12 and a virtual environment. This Python tooling is for development;
neither phone will install or execute Python.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-model.lock.txt
bash scripts/build-model.sh
bash scripts/test-model.sh
```

`requirements-model.txt` lists the three direct dependencies; the lock file also
pins the transitive versions used for the recorded run. If dependencies are
already installed, run the last two commands. Scripts resolve their own project
root; set `MINIMOL_PYTHON` to use another compatible Python environment.

The test command verifies the on-disk build and writes real pytest/JUnit output
under `artifacts/reports/`. Golden tests require generated weight files. The
baseline golden JSON is retained in `tests/fixtures/`; regenerating it intentionally
changes the oracle, so inspect any diff before accepting a new model version.

Useful independent commands, from the project root:

```bash
# Re-export shards from the existing verified canonical file, without reseeding.
.venv/bin/python -m model.export_weights

# Verify the full development bundle and exact reconstruction.
bash scripts/verify-model.sh

# Verify only the public deployment shards (no full-model file needed).
bash scripts/verify-model.sh --public-only

# Execute model tests directly after generation.
.venv/bin/python -m pytest -q
```

All Python entry points use `python -m model.<module>` so imports are independent
of ad hoc PYTHONPATH changes. The generator also accepts `--canonical-dir`,
`--public-dir`, and `--golden-path` for isolated reproducibility runs.

## Model and artifacts

The exact model has a 256-byte vocabulary, 512 learned positions, six pre-LN
blocks, width 384, six heads of width 64, and MLP width 1536. It uses causal
attention, exact erf GELU, LayerNorm epsilon 1e-5, biased internal projections,
and an untied bias-free head. Construction order and PyTorch default
initialization are fixed with `torch.manual_seed(42)`.

| File | Parameters | Bytes | Purpose |
| --- | ---: | ---: | --- |
| `artifacts/model/weights.bin` | 11,040,768 | 44,163,072 | Canonical development file only |
| `public/model/phone1.bin` | 5,618,304 | 22,473,216 | Embeddings + layers 0–2 |
| `public/model/phone2.bin` | 5,422,464 | 21,689,856 | Layers 3–5 + final LN + head |

The public manifest lists only the two shard files. The internal manifest also
describes the canonical file. Both specify all 77 tensors, shapes, little-endian
FP32 layout, offsets, ownership, sizes, hashes and generator versions. Binary
files and the virtual environment are excluded from Git and are reproducibly
regenerated by the build command. Generated files are present locally after the
recorded build; ignoring them does not remove them.

Seven golden cases contain split activations, logits, greedy IDs and short
autoregressive byte sequences for ASCII, UTF-8, arbitrary byte values, and all 512
positions of context (selected vector samples for the long case). Cross-engine
checks require `atol=1e-4, rtol=1e-4` and identical greedy bytes. The current same-CPU
full-vs-reloaded-shards check requires exact tensor equality.

These are **untrained** seeded weights. They generate real model predictions,
which may be nonsensical and invalid UTF-8. There is no tokenizer, BOS/EOS, trained
replacement, hardcoded output or external inference API. Empty/overlong prompts
are rejected. At most 512 input positions are processed; a prediction made at
position 511 is valid, but must not be fed back into position 512.

## Files and next milestones

- [ARCHITECTURE.md](ARCHITECTURE.md): complete system boundaries and constraints.
- [SPEC_DECISIONS.md](SPEC_DECISIONS.md): initialization, format, ambiguities and risks.
- [TASKS.md](TASKS.md): milestone acceptance criteria and pending work.
- [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md): actual results and limitations.
- [MILESTONE_2_REPORT.md](MILESTONE_2_REPORT.md): CPU, KV, Workers, WASM and browser evidence.
- `model/`: canonical reference, generator, exporter, verifier and role-only loaders.
- `src/inference/`: browser role engines, math, KV, loading and generation.
- `src/workers/`: browser Worker entrypoint and shared request handler.
- `wasm/src/`: freestanding C++ scalar/SIMD matrix kernel source.
- `tests/inference/`, `tests/browser/`: CPU, worker and browser checks.
- `tests/model/`: independent math, integrity, isolation and golden regression tests.
- `tests/fixtures/golden_vectors.json`: numerical oracle for the next CPU engine.

M2 implements scalar TypeScript CPU inference and incremental role-specific KV
caches, with tested WASM/SIMD linear acceleration. M3 will prove two-runtime inference through the production binary protocol.
M4 adds direct host-only WebRTC and QR/manual signaling. M5 integrates the mobile
UI and Workers, M6 proves offline use, M7 adds WASM/SIMD and measured optimization,
and M8 validates physical phones and deployment. Emscripten and CMake are absent;
WASI SDK builds the optional WASM kernels and TypeScript is the fallback.

## Future deployment and real-device validation

Only the eventual built web application and its role-specific public assets may
be served from a static **HTTPS** origin. Never serve the repository root or
`artifacts/`, and never precache/fetch both shards on a phone. All runtime
dependencies must be bundled. No STUN/TURN, cloud inference, native app, WebGPU
or WebGL is permitted. `public/` currently contains weight and WASM assets, not a
production website; there is no `npm run dev` command yet.

The required pairing flow will exchange completed offer/answer SDP via bundled
QR scanning or manual copy/paste, with an empty ICE-server list. Actual selected
host candidates and opposite-role/model/hash handshakes must be checked.
Offline testing must disable Internet while retaining the local Wi-Fi/hotspot.
The final device checklist must cover iPhone Safari, Android Chrome,
Android+Android and iPhone+Android, cold/warm cache, network isolation,
disconnect/retry, context limits and background suspension. These trials and
mobile benchmarks have **not** been executed in Milestones 1–2.
