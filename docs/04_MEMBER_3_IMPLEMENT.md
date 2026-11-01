# MEMBER 3 — BEGIN IMPLEMENTATION NOW (WebRTC + mobile UI)

You own `web/src/network/**`, `web/src/ui/**`, `web/src/main.js`, `web/src/style.css`, `web/index.html`, `web/package.json` and deployment. Do not modify the ML model, weights, engine math, or shared tensor formats.

## Exact first tasks in order
1. Read `docs/01_FROZEN_CONTRACT.md`, `web/src/network/protocol.js`, `peer.js`, `src/ui/qr.js` and `src/main.js`. Understand offer/answer/ICE, why `iceServers:[]` avoids TURN, and why `RUN_START` / READY / ordered activations are sequential.
2. Run `cd web && npm install && npm test && npm run build` (after Member 1 generated assets). The app is a static Vite bundle; deploy over HTTPS at domain root. NO inference backend and NO server-side signaling.
3. Test two actual phones on the same Wi-Fi. Phone 1: create offer QR. Phone 2: scan offer, show answer QR. Phone 1: scan answer. Verify WebRTC DataChannel open on both, and candidate-pair stats are local/host (never relay).
4. Send a known 384-float array in the binary 1,552-byte frame and compare every bit after WebRTC transfer before connecting the math engine.
5. Test complete `RUN_START -> READY -> activation -> BYTE/STEP_DONE -> END` flow using Member 2 engine and Member 1 fixtures. Confirm `Hi` => provisional greedy outputs [30,18,116] and both phones' visible compute traces.
6. Fix reliable QR signaling on all stock browser targets. Current compressed single-frame QR has a fallback paste box but may be too large/dense for arbitrary SDP. Implement *multi-part QR / reassembly* if needed; never truncate SDP. Ensure Safari permissions and camera scanning work over HTTPS.
7. Robustness: permission denied, different Wi-Fi, isolated Wi-Fi, stale/duplicate messages, missing weights, disconnect/abort and restart, 512 context boundary, two consecutive runs, screen sleep, offline WAN after load. Add clear error messages and end-to-end tests.
8. Collect meaningful per-phone timing, RTT and generation throughput and distinguish prefill from decode. Keep model math in Member 2's engine. Avoid loading both shards on the same phone.

## Frozen packet/API reminder
Activation: 16-byte header + 384 FP32, **exact 1552 bytes**. JSON HELLO/READY/RUN_START/STEP_DONE/BYTE/END/ERROR. One in-flight frame. Start after both phones say HELLO with matching full model SHA256. All inference bytes over the direct WebRTC DataChannel. Both device browsers use normal stock Safari/Chrome, zero install.

## Your pull request must include
HTTPS deployment URL, screen recordings or real-device logs from both phones, selected ICE candidate types, demonstration with router internet unplugged (Wi-Fi still ON), successful 10-byte run, and notes for unreproducible device/network limitations.

## Paste this into your own coding LLM
"I am Member 3, owner of ONLY web/src/network/**, web/src/ui/**, web/src/main.js, style.css, index.html, package.json and deployment for Minimol P2P. Read README.md and docs/01_FROZEN_CONTRACT.md and inspect the existing QR/WebRTC/generation code. My job is to harden a browser-only two-phone pairing and inference app. Preserve Member 2's createEngine/forwardByte/forwardActivation API and the exact 1,552-byte activation packet. There must be NO STUN/TURN, centralized relays, inference backend, native application or GPU compute. First make pairing and binary-frame round trips work on stock mobile browsers, then integrate the real engine and test the complete run, WAN-offline after load, and failures. Implement incrementally with exact file diffs and verification steps. Do not rewrite other members' folders."
