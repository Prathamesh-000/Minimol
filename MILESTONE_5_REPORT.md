# miniMol — Milestone 5 engineering report

Build **88806f5edebf4376**. Implemented incrementally over the working M1–M4 engines and transport. The user
reported successful M4 inference on two physical smartphones before this work.
That is user-reported M4 evidence, not validation of the new M5 features.

## Architecture and changes

- A generated, versioned service worker caches the HTML shell, versioned modules,
  manifest, WASM variants and locally bundled QR libraries. It never precaches a
  model binary. Installation must complete before activation; failed installs
  remove partial shell caches. Updates do not call skipWaiting or reload active
  sessions. Old shell caches are deleted only after safe activation.
- The role Worker uses `loadCachedShard`, wrapping the existing `decodeShard`
  verifier. A complete download must pass size, SHA-256 and FP32 validation before
  it is saved. Cached bytes are verified again before use. Damaged cache entries
  are deleted; online retry fetches fresh bytes. Interrupted downloads are not
  committed. Storage/quota failure preserves verified online inference but reports
  that offline preparation is incomplete. One role per browser profile: selecting
  another role clears the previous disk shard. The role selection survives reload.
- Offline shell preparation is an explicit button. The dashboard distinguishes
  cached assets from an actually observed offline reload. Storage persistence is
  requested, not assumed. The optional development IP hint remains network-only;
  manual own-Wi-Fi IP entry works without it. Local Wi-Fi remains essential.
- QR generation uses pinned qrcode-generator 2.0.4; image decoding uses jsQR 1.4.0.
  Both libraries are copied into the versioned build, with license notices, and
  included in shell caching. No CDN/runtime dependency is used.
- QR frames carry version, type, SHA-256 exchange identifier, creation time, chunk
  count/index and at most 320 characters. At most 220 chunks are accepted, with
  bounded payloads, 15-minute expiration, wrong-role/mixed-exchange/conflicting
  chunk rejection and full-message checksum verification. Reordered/duplicate
  identical chunks are supported. Completed text goes through existing SDP
  validation. Scanning fills the remote text box; the user still explicitly
  presses Create answer or Apply answer. Manual signaling and direct-IP export
  remain unchanged. The QR expiry does not expire the manual offer.
- Camera scanning uses a local video/canvas decoder and environment-facing camera
  preference. Stop, hidden-page and page-exit handlers release tracks. Camera
  failure leaves manual text pairing available. Stale asynchronous camera requests
  cannot restart scanning after Stop.
- The responsive dashboard exposes assigned layers, shard/cache verification,
  network availability, ICE/channel/handshake state, output count/speed, protocol
  bytes and KV occupied/allocated memory. Speed is Phone 1 output bytes per elapsed
  second including prefill; it is not a fabricated model benchmark. Phone 2 labels
  output coordination as occurring on Phone 1. Network counters include protocol
  headers/control traffic, not lower-level ICE/DTLS overhead. KV occupancy is actual
  engine position times three layers' key/value storage; allocation stays 4.5 MiB.
- A discovered byte-counter bug was corrected: Worker postMessage transfer detached
  outgoing buffers before their lengths were counted. Length is now captured
  before send. Neither the transmitted data nor the protocol format changed.

No changes to model architecture, parameter count, binaries, shard ownership,
Transformer math, KV semantics, coordinator or inference execution location.
No WebGPU, WebGL, cloud inference, TURN, STUN or activation relay was added.
The existing HTML/TypeScript app was retained; no frontend-framework rewrite.

## Actual tests executed

| Command | Actual result |
| --- | --- |
| `npm test` | **66 passed**, 0 failed/skipped; original M2–M4 tests plus QR and transferred-buffer metrics tests |
| `bash scripts/test-model.sh` | **65 passed**, weight hashes and exact reconstruction verified; 11,040,768 parameters |
| `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server` | **3 passed** |
| `npm run test:browser` | **21 golden runs passed**, seven each for TypeScript, scalar WASM and SIMD WASM |
| `npm run test:webrtc` | **13 scenarios passed**, all seven canonical golden prompts over real WebRTC |
| `npm run test:milestone5` / final `node scripts/test-milestone5.mjs` | **10 browser scenarios passed** |
| `npm run build:demo` and `npm run typecheck` | Passed; generated demo-dist and strict TypeScript checks |
| Pinned npm dependency installation | 0 vulnerabilities reported by npm audit during installation |
| Safari WebDriver session creation | **Not available:** Safari returned remote-automation-disabled; no preferences changed, no Safari test claimed |

Automated browser environment: installed desktop Chrome 156.0.8078.74, separate
browser contexts and separate role Workers. Mobile viewport 390×844 was checked
for horizontal overflow and a dashboard screenshot was inspected. This is not
physical-phone or iOS engine testing.

### Offline evidence

The two contexts first loaded and cached their own shards independently. All
browser networking was then disabled; both pages reloaded shell/modules/Workers,
manifest/WASM and verified their assigned cached shards successfully. Next, local
networking was restored for ICE but **every HTTP request was aborted**; both pages
cold-loaded from cache, paired over real WebRTC and generated the canonical Hello
bytes. The asset server received **zero requests** throughout these offline/cached
reload and generation stages. Network-off emulation and HTTP-host independence
are separate tests; neither proves WAN-off operation on a physical phone.

Corrupt cached bytes were rejected/deleted, unavailable offline replacement failed
honestly, and online retry repaired the shard. A truncated 500-byte response was
never cached; retry succeeded. A Cache.put quota error injected in the isolated
Worker preserved online verified model loading with `cached: false` and a visible
warning. No peer shard was downloaded in either role context.

### QR and dashboard evidence

The final test captured screenshots of displayed QR codes at mobile viewport size for every offer and answer chunk,
decoded those images in the other browser using the production decoder, applied
the reconstructed signaling, completed host/host verification and generated
`[63,119,179,184,253,37,243,172]` for `Hello`, eight new bytes. Dashboard checks
asserted eight output bytes, positive measured speed, actual protocol traffic and
0.11 MiB occupied KV for 12 processed positions. Separate unit tests rejected
malformed, expired, future-dated, wrong-role, mixed and corrupted QR messages.
Camera-unavailable fallback was tested; **physical camera scanning was not**.

The original M4 suite still exercises manual/direct-IP pairing, repeated runs,
reconnection, disconnect during generation, malformed frames and golden numerical
comparisons. All generated IDs agree with the existing reference. The untrained
model produces byte sequences, not meaningful natural-language answers.

### Failures caught and fixed while testing

- Full-resolution QR decoding initially passed, but actual mobile-size screenshots
  failed. Chunks were reduced to 320 characters and displayed modules aligned to
  whole CSS pixels. The final mobile-size screenshot decoding test passes in both
  directions; physical camera optics still require validation.

- The QR package has no top-level LICENSE file. Build packaging was corrected to
  retain its distributed copyright/MIT notice and the decoder's license file.
- A cached Response carried its canonical URL and dropped the Worker's `?role=`
  query. Returning a fresh Response preserves the original requested Worker URL;
  the offline test caught this and subsequently passed for both roles.
- Dashboard inspection exposed the detached-buffer byte counter described above.
- The initial quota test patched the page's Cache prototype, which does not affect
  a separate Worker. Fault injection was moved into the Worker module before
  recording the passing quota-failure scenario. Failed attempts are not passes.

## Files created and modified

Created:
- `src/offline/shardCache.ts`
- `src/networking/qrPayload.ts`
- `src/demo/dashboard.ts`
- `demo/sw.js` (build template)
- `tests/networking/qrPayload.test.mjs`
- `scripts/test-milestone5.mjs`
- `MILESTONE_5_REPORT.md`

Modified:
- `src/workers/distributed.worker.ts`, `src/demo/session.ts` — cache loader and load-status bridge.
- `src/networking/transport.ts`, `tests/networking/transport.test.mjs` — accurate transferred-buffer counters and regression.
- `demo/index.html`, `scripts/build-demo.mjs` — dashboard, persistent role choice, QR controls, bundled vendors and generated service worker.
- `package.json`, `package-lock.json` — pinned local QR dependencies and M5 test command.
- `README.md`, `ARCHITECTURE.md`, `SPEC_DECISIONS.md`, `TASKS.md`, `ENGINEERING_REPORT.md` — current behavior and validation scope.

Raw evidence: [M5 browser scenarios](artifacts/reports/milestone5-browser.json),
[dashboard screenshot](artifacts/reports/milestone5-dashboard.png),
[JS regression output](artifacts/reports/milestone5-js.txt),
[model verification/tests](artifacts/reports/milestone5-model.txt),
[M4 browser golden results](artifacts/reports/milestone4-webrtc.json),
[M2 browser results](artifacts/reports/milestone2-browser.json).

## Run and demonstrate

```bash
cd /Users/vikrantsaini/Documents/miniMol
npm ci
npm run build:demo
python3 -B scripts/serve-demo.py \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop an existing port-8443 server with Ctrl+C before starting this helper. Open
`https://10.10.203.5:8443/` directly in Safari/Chrome on each phone while that remains
the Mac's Wi-Fi address. If the Mac's IP changes, regenerate its certificate for
the new address and use the new URL. Retain trusted certificate installation.

1. Choose Phone 1 on one device and Phone 2 on the other. Load each shard and wait
   for SHA-256 verification and cached status. Keep one miniMol role/tab per device.
2. Press Prepare offline shell on each phone. Wait for shell + shard cached status.
   This status alone is not proof of physical offline operation.
3. Verify each phone's own Wi-Fi IP before signaling, using the working M4 numeric
   IP approach. Do not enter the Mac's IP into the phone IP field.
4. Phone 1 creates an offer and presses Show QR. Phone 2 presses Scan other phone,
   grants camera access and scans every numbered code, using Next on Phone 1.
   Once complete, Phone 2 presses Create answer and displays its answer QR codes.
5. Phone 1 scans all answer codes, then presses Apply answer. Manual text remains
   available at every step. Keep both original tabs foregrounded.
6. Wait for CONNECTED/verified handshake. On Phone 1 generate `Hello` with 8 new
   bytes. Check exact IDs above. Phone 2 automatically executes its assigned layers.
7. For a physical offline trial, retain local Wi-Fi but disable upstream Internet;
   optionally stop the Mac asset server as a stronger check. Reload the same URL,
   load each remembered role, exchange fresh signaling and generate again. Record
   actual phone/browser versions, outputs and failures. Do not turn off Wi-Fi.
8. For a software update, reconnect the host, prepare/check the new shell, close
   ALL miniMol tabs to activate a waiting worker, then reopen. Never update/reload
   during a live generation.

## Remaining limitations

New M5 iOS Safari/Android Chrome camera, storage eviction, WAN-off/reload and
physical reconnection trials remain pending. The earlier physical success is M4
user evidence only. Safari remote automation was disabled; it was not enabled.
Browser storage can be evicted or denied, and private browsing may restrict it;
reconnect/reload/reprepare if assets are missing. Storage persistence is best effort.
Downloads retry from the beginning; HTTP range resume is not implemented.

QR optical reliability under real lighting/distance and dense multi-code payloads
needs physical testing. Clocks must be reasonably synchronized for 15-minute QR
expiry; manual text is the fallback. QR checksums detect corruption, not peer
identity. Old offers whose tabs were closed cannot be revived by rescanning.
Numeric Wi-Fi candidates cannot bypass client isolation or blocked peer UDP.
Backgrounding/locking a phone can interrupt camera, Worker or WebRTC execution.
The dashboard remains the existing HTML/TypeScript architecture, not the original
roadmap's deferred React rewrite. This report does not claim every hackathon
milestone or physical compatibility matrix is complete.

References used: [Service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers),
[QR encoder](https://github.com/kazuhikoarase/qrcode-generator),
[QR decoder](https://github.com/cozmo/jsQR).

## Follow-up verification of the repeated M5 request

The existing implementation was inspected and retained. No inference, networking,
cache, QR or UI source was recreated or changed during this follow-up.

Fresh checks executed successfully:

- `npm test`: 66 passed, zero failures/skips, 32.329 seconds.
- `bash scripts/test-model.sh`: 65 passed in 4.99 seconds; hashes and reconstruction verified.
- `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server`: 3 passed.
- `npm run build:demo` and `npm run typecheck`: passed.
- Build remains `88806f5edebf4376`: 37 shell assets, no `.bin` precache entries,
  and no `weights.bin` anywhere in demo-dist.

A requested fresh `npm run test:milestone5` browser run was not executed:
automatic approval review could not complete because of an account usage limit.
The tool explicitly identified this as a review failure, not an unsafe-action
finding. No alternate path was used to bypass the review. The 10 M5, 13 M4 and
21 M2 browser results above remain evidence from the earlier executed runs in
this chat, not freshly rerun browser results. Physical M5 validation remains
pending. To repeat locally when browser execution is available:

```bash
npm run test:milestone5
npm run test:webrtc
npm run test:browser
```
