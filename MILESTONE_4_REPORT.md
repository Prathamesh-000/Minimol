# miniMol — Milestone 4 browser WebRTC report

Real browser-to-browser WebRTC inference is implemented and verified on desktop
Chrome. **Physical-phone success is unverified.** The user supplied iPhone pairing
failure screenshots; no successful physical inference has been established.

## Latest connection fix — 1 November 2026

The supplied `151e552ef9cf3c90` logs show both shards/WASM loading. Screenshots
show an answer accepted followed by a direct-connection deadline, with only
`.local` host candidates. This is a failure before the model handshake, so keeping
Generate disabled is correct. It is not evidence of an inference or shard error.
The evidence cannot distinguish mDNS filtering, client isolation, browser local
network policy, or a peer losing its foreground session. Multicast reachability
is a known limitation described in the [IETF mDNS ICE draft, section 5.1](https://www.ietf.org/archive/id/draft-ietf-mmusic-mdns-ice-candidates-03.html#section-5.1).

Build **`d46cc694f9f358c3`** adds explicit private Wi-Fi IPv4 entry on both phones.
Only exported mDNS UDP host addresses are substituted; existing port, credentials,
fingerprint, local description and binary protocol are preserved. IPv4/IPv6
literal candidates are unchanged. The browser must still establish and verify a
host/host path and the model handshake. No STUN/TURN, relay, full model or fake
output was added. Use each phone's actual Wi-Fi IP, not the Mac's address.

The updated `scripts/serve-demo.py` offers an optional `/network-info` response
containing only the requesting socket's private IPv4, without consulting forwarded
headers. This is an address suggestion, not a signaling/peer registry. It stores
no state and accepts no activation/SDP posts. Manual address entry works without
this endpoint on ordinary static hosts. The suggestion must match Wi-Fi settings;
VPNs/proxies/NAT can make it unsuitable. The helper was actually exercised over
trusted HTTPS at the Mac's LAN address on temporary port 18443 using the existing
mkcert certificate. A GET returned HTTP 200, `Cache-Control: no-store`, and only
the calling Mac's address. The user's existing port-8443 server was left running;
restart it to activate the new endpoint.

Connection diagnostics now expose ICE/gathering/channel states, candidate counts,
candidate-pair request/response counters, a bounded event history and handshake
readiness. They omit SDP credentials and candidate addresses. Already-open remote
channels are handled; a late deadline cannot close an already verified path. The
Generate button is controlled by session readiness, remains disabled after an
interrupted UI generation, and is explicitly Phone-1-only. Phone 2 is the worker.

Actual verification of this fix:

- `npm run test:webrtc`: **13 scenarios passed**, including all **7 PyTorch golden
  prompts**, unchanged role-only shard checks, a controlled unresolvable-mDNS
  failure, and actual Load → Offer → Answer → Apply → Generate button automation
  using the Mac's real LAN IPv4 and normal browser settings. Both selected paths
  were host/host, both workers processed 12 positions for `Hello` + 8 outputs, and
  generated IDs were `[63,119,179,184,253,37,243,172]`.
- `npm test`: **63 passed**, zero failures/skips, including original M2/M3 tests.
- `.venv/bin/python -B -m pytest -q -p no:cacheprovider`: **65 model tests passed**.
- `.venv/bin/python -B -m pytest -q -p no:cacheprovider tests/server`: **3 passed**.
- Model verification: **11,040,768 parameters**, original hashes, exact shard
  reconstruction. `build:demo` succeeded and produced the version above.

Files changed: `src/networking/pairing.ts`, new `lanCandidates.ts`,
`src/demo/session.ts`, `demo/index.html`, `scripts/serve-demo.py`,
`scripts/test-webrtc.mjs`, new `tests/networking/lanCandidates.test.mjs`, new
`tests/server/test_serve_demo.py`, and architecture/decisions/tasks/README/report.
Inference engines, model binaries, coordinator and protocol bytes are unchanged.

Limits: these are two browser contexts on one Mac, **not two physical phones**.
The controlled mDNS failure is a test condition, not a reproduction proving this
Wi-Fi's exact policy. Numeric IPs remove the name-resolution dependency but cannot
override blocked peer traffic, wrong IPs, browser denial or suspension. Such a
network requires a compatible non-guest Wi-Fi/hotspot or administrator changes;
the code will not claim CONNECTED or enable generation without a real path.

## Architecture

The M3 binary codec, DistributedRuntime and DistributedCoordinator are unchanged.
`WebRTCTransport` implements the existing BinaryTransport contract over one
reliable ordered RTCDataChannel. It sets binaryType=arraybuffer, applies frame
limits, forwards bufferedamountlow events, buffers at most eight startup frames,
and propagates close/error events. Existing BoundedSender queues and deadlines
are reused on both sides of the worker/network bridge.

The main thread owns RTCPeerConnection and manual SDP exchange. Each phone has one
dedicated distributed Worker containing its own verified shard, three-layer
engine, KV cache and protocol runtime. Phone 1's coordinator runs in that Worker.
Only binary frames and commands pass between the main thread and local Worker.
Outgoing worker writes are acknowledged when accepted by the main thread's
bounded DataChannel sender; its bufferedAmount provides real backpressure.

Pairing always uses `RTCPeerConnection({ iceServers: [] })`. Phone 1 creates the
channel and completed offer; Phone 2 creates the completed answer; Phone 1 applies
it. No trickle signaling server, STUN, TURN or activation relay is configured.
Incoming signaling is bounded and validated for version, role, type, application
SDP and host-only candidates. Selected candidate-pair stats must confirm host on
both ends before the application HELLO/READY handshake starts. Candidate addresses
are not copied into reports or the status dashboard.

## Actual executed tests

| Validation | Result |
| --- | --- |
| All existing M1 Python tests | **65 passed**, 4.16 seconds; hashes/reconstruction verified |
| All existing M2/M3 JavaScript tests | **58 passed** before adding signaling tests |
| Final JavaScript suite including signaling/address tests | **63 passed**, zero failures/skips |
| HTTPS own-IP helper tests | **3 passed** (separate from default model pytest path) |
| Real WebRTC browser suite | **13 scenarios passed**, Chrome **156.0.8078.74** |
| Golden inference over real DataChannel | **All 7 prompts passed**, 595 processed positions per role |

All **123 existing regression tests** passed. Two additional signaling tests check
size, JSON/schema, opposite roles, message types and rejection of non-host
candidates. Three additional address-handling and three helper tests bring the
Node+Python total to 131; browser scenarios are separate.

The browser suite uses two separate contexts, one model Worker per context and
actual RTCPeerConnections. Automation transfers offer/answer strings only.
Activations/predictions travel over DataChannel; the test server serves static
assets and receives no tensor data. Per-context network audits confirm Phone 1
fetches only phone1.bin and Phone 2 only phone2.bin. All selected ICE pairs are
verified direct host-to-host. Both runtimes' positions, traces and three-layer
evaluation counts are checked.

All 49 expected generated bytes and all checked greedy IDs match PyTorch. Across
46 stored golden activation/logit samples, maximum absolute errors remain
**1.847744e-6** and **1.668930e-6**, within the original absolute/relative tolerances.
The long-context case processes 512 positions; its fixture contains five sampled
vectors, not a vector for every position.

The browser scenarios also verify malformed/duplicate signaling, abrupt
disconnection, fresh offer/answer pairing and subsequent generation, disconnect
during active incremental generation with rejection of the pending operation, rejection of
a malformed text DataChannel message, delayed manual exchange without expiry,
and unreachable-peer timeout after applying an answer. Abrupt
connection closure produced a DataChannel error on the peer. An early test used
overly specific UI-message matching and timed out; the final assertion checks
the real closed connection state. The first test server route also omitted
digits in engine module names; this was corrected before successful runs.

Raw evidence:

- [WebRTC scenarios, numerical results and role-specific asset requests](artifacts/reports/milestone4-webrtc.json)
- [Latest JavaScript regression output](artifacts/reports/connection-fix-js.txt)
- [Latest weight verification](artifacts/reports/connection-fix-weights.json)
- [Python regression output](artifacts/reports/model-tests.txt)
- [Weight integrity](artifacts/reports/weight-verification.json)

## Run the two-phone demo

```bash
npm ci
npm run build:demo
```

Upload **only demo-dist/** to a static HTTPS host, or serve that folder with a
certificate trusted by both phones. Never serve the repository root, artifacts,
or .tools. No deployment was performed in this milestone. The static folder
includes role shards and WASM assets; the browser downloads only the selected
shard. It contains no canonical weights.bin. All dependencies are local assets.

1. Open the same HTTPS URL on two phones connected to the same Wi-Fi or compatible
   hotspot. Keep both browser pages foregrounded and screens awake.
2. Select Phone 1 on one device and Phone 2 on the other. Press **Load selected
   shard / retry** on each and wait for hash verification.
3. Phone 1 presses **Create offer**, then manually transfers the entire signaling
   text to Phone 2's remote-text box.
4. Phone 2 presses **Create answer**, then transfers its entire answer to Phone 1.
5. Phone 1 pastes it and presses **Apply answer**. Both devices must display the
   verified model handshake and direct host path before generation is enabled.
6. On Phone 1, enter a prompt and generate. Phone 2 actively computes every step.
   Output is untrained-model bytes and need not be readable prose.
7. To stop or recover, disconnect and press **Load selected shard / retry** on
   both devices, then exchange a fresh offer and answer. Existing caches are not
   resumed after an uncertain connection interruption.

The copy button uses the clipboard when permitted; the textarea remains selectable
for manual copy. Copy/paste was selected under the user's QR-or-copy/paste M4
requirement. QR generation/scanning is not implemented.

Reproduce automated checks with `npm run test:webrtc`, `npm test`, and
`npm run test:model`. Set MINIMOL_CHROME for a Chrome executable at another path.
The browser test uses a loopback HTTP origin (a trusted local browser context);
ordinary HTTP LAN URLs are not a substitute for trusted HTTPS on physical phones.

## Reliability and compatibility limits

### Manual-pairing timing fix

Subsequent phone screenshots showed `No pending Phone 1 offer`. This means no
active local offer remains when applying the answer; it does not identify whether
expiry, reload, prior application or another closure caused that state. Apply
Answer now distinguishes those cases and preserves the original closure reason.
Closed sessions disable pairing controls. The rebuilt demo displays a build ID
and loads modules/Workers from a content-versioned asset directory, avoiding stale
module reuse across builds. A browser test verifies expired-answer diagnostics.
The latest run passed 10 browser scenarios, 60 JS tests and 65 Python tests.

For local trials, stop the old server with Ctrl+C and run:

```bash
cd /Users/vikrantsaini/Documents/miniMol
python3 -B scripts/serve-demo.py \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

This helper serves only demo-dist with no-store headers. Expected broken-pipe,
TLS EOF and connection-reset errors from interrupted clients produce a short
log entry; unexpected errors still propagate. Those handler paths were tested.
This logging improvement does not claim to fix the underlying network condition.
The helper's HTTPS listener has not been physically tested on the user's phones.

A reported mobile HTTPS log showed an abruptly terminated shard response
(`SSLEOFError`). That log alone does not prove why the download ended. Inspection
found that the original 45-second pairing deadline included model loading and
idle time before any offer existed, and could terminate the downloading Worker.
An initial fix allowed three minutes after offer/answer creation. Subsequent phone
screenshots confirmed that this still expired during manual exchange. The current
build has **no application countdown during manual exchange**. Phone 1 retains
its offer until an answer is applied, the user resets, or the browser itself
closes/fails the connection. The connection deadline starts only after Phone 1
successfully applies an answer. Phone 2 does not expire its answer while waiting
for the manual return trip. Real ICE failures and request/liveness deadlines
remain enforced; this does not assert that every Wi-Fi permits host-only peers.

The regression deliberately waits longer than a configured three-second timeout
before offer creation, after the offer, and after the answer. It then applies the
original answer, verifies direct connectivity and generates the canonical bytes.
A separate test removes peer candidates and closes the other peer, verifying
failure/timeout after answer application. The rebuilt demo passed 10 browser
scenarios, all 60 JS tests and 65 Python tests. Load-button protection, explicit
closure reasons, build IDs, versioned assets and the no-cache server remain.

For prompt `Hello` and eight generated bytes, the reference output IDs are
`[63,119,179,184,253,37,243,172]`. The demo displays the actual generated byte IDs
alongside decoded text. The model is untrained; coherent prose is not expected.
The manual-exchange fix was build `151e552ef9cf3c90`; the latest numeric-address
fix is documented above. Physical two-phone success is still pending;
the screenshots establish an application timeout failure, not successful ICE or
inference on the phones.

- Connection and ICE-gathering deadlines produce errors suggesting the same Wi-Fi
  or a compatible hotspot. There is no relay fallback. Some networks isolate
  clients, block UDP or prevent host/mDNS candidate connectivity.
- The session sends protocol PING/PONG while idle. A 20-second inbound liveness
  deadline and existing per-request timeouts prevent indefinite stale readiness.
  Browser suspension can delay timers; foreground recovery may therefore close
  the session. Reconnection always creates fresh peers, Workers and caches.
- iOS Safari backgrounding, screen locking, memory pressure, clipboard permissions
  and candidate-stat availability need real-device validation. The app fails
  clearly if it cannot verify host-to-host candidate stats. It does not claim
  universal browser/network connectivity.
- No native app, GPU API, inference service or full-model fallback was introduced.
  CPU inference remains in Workers; WASM linear acceleration keeps scalar fallback.
- This is a practical minimal demo, not M5's React dashboard. Offline app/shard
  caching, QR scanning, polished UI, mobile benchmarks and physical-device
  compatibility remain pending. Internet-independent inference after caching
  has not been validated here.

Required physical test matrix (all **pending**): iPhone Safari + Android Chrome,
two Android devices, same Wi-Fi and hotspot, disconnect during generation, retry,
screen lock/background recovery, clipboard denial, full context, and later WAN-off
operation after M6 caching. Desktop browser automation is not physical evidence.

## Files added or changed

Added `src/networking/webrtcTransport.ts`, `pairing.ts`,
`src/workers/distributed.worker.ts`, `src/demo/session.ts`, `demo/index.html`,
`scripts/build-demo.mjs`, `scripts/test-webrtc.mjs`, and
`tests/networking/pairing.test.mjs`. Updated package commands, .gitignore and
milestone/architecture documentation. Existing simulation transports and tests
remain available. The canonical model, binaries, golden fixtures, protocol framing
and M1–M3 inference implementations were preserved.

Browser API references: [DataChannel buffer-low notification](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold),
[candidate-type stats](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidateStats/candidateType).
