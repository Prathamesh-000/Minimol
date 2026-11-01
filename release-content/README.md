# miniMol release

Two smartphones execute one deterministic 11,040,768-parameter FP32 Transformer.
Phone 1 owns embeddings/layers 0–2; Phone 2 owns layers 3–5/final norm/output.
Every predicted byte requires both browsers through a direct WebRTC DataChannel.
CPU-only JavaScript/WASM; no cloud inference, TURN, activation relay, GPU or analytics.
The model is RANDOMLY INITIALIZED AND UNTRAINED: meaningful language is not expected.

## Source build

From the source project, use Node 24.6.0 (tested), npm lockfile and Python 3.12
with requirements-model.lock.txt for model regeneration/tests:

```bash
npm ci --ignore-scripts
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-model.lock.txt
npm run build:demo
npm run reproduce:model
npm run release:build
npm run release:verify
```

The regeneration audit requires existing verified original weights/goldens. On a
fresh source checkout without weight binaries, first run `.venv/bin/python -m
model.generate_weights` to create them. This uses seed 42, pinned PyTorch/NumPy,
one CPU thread and deterministic algorithms. Never overwrite valued artifacts
without running `model.verify_weights` first; reproduce:model always writes to temp.

Prebuilt scalar/SIMD WASM assets are included. Recompiling them requires the
compiler described in source scripts/build-wasm.sh (tested WASI SDK 25/LLVM19.1.5).
Compiler/platform differences may change WASM bytes. The release verifier pins the
accepted prebuilt kernels; deliberate updates need reviewed pins and golden tests.
Only demo/ is web content. No Python is required on either phone.

## Serve

From source use the HTTPS helper (select the verified release distribution):

```bash
python3 -B scripts/serve-demo.py --directory release/demo \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Or host this package's demo/ on a trusted static HTTPS server. Use a certificate
trusted by both phones; never publish private CA/server keys. See docs/FINAL_DEMO_GUIDE.md
for iPhone/Android trust, exact local setup, own-phone IP entry and QR/manual pairing.
The HTTPS helper's own-IP hint is optional; a static host supports manual IP entry.

Load different roles, prepare each offline shell, pair via QR or manual text and
wait for verified host path/model handshake. Generate Hello/8 on Phone 1. Expected
IDs: [63,119,179,184,253,37,243,172]. Inspect both dashboards and participation.
For offline trials keep local Wi-Fi, remove WAN/asset host access and cold reload.
Physical camera/offline/resume/download/mobile benchmark checks remain NOT TESTED.

RELEASE_MANIFEST.json records every package file except itself/checksum list;
RELEASE_CHECKSUMS.txt also hashes the manifest, excluding only its own self-hash.
This is corruption detection, not signed publisher authentication. Use the source
`npm run release:verify` to check integrity and model/runtime requirements.

## M8 mobile reliability

Read docs/MOBILE_COMPATIBILITY.md. Keep both pages foregrounded during the active
pair; a hidden/frozen/stale session is discarded and requires fresh pairing on both
phones. Manual offers can wait while copying, but return both pages before applying
the answer. Diagnostics expose capabilities, actual backend, measured load/prefill,
partial memory and recovery state. Run `npm run test:mobile` for desktop synthetic
lifecycle/Worker recovery tests. Actual phone checks remain NOT TESTED. Release
builds retain verified rollback copies under release-archives/.
