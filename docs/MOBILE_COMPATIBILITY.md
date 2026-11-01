# miniMol mobile compatibility and reliability

## Evidence scope

M8 improves defensive behavior; it does not certify a browser because APIs exist.
Desktop Chrome tests use real Workers/WebRTC plus clearly labeled synthetic
visibility/freeze/timer changes. Actual stock iPhone Safari and Android Chrome
camera, offline reload, lock/resume, interrupted-download recovery and performance
remain NOT TESTED. Prior user-reported M4 inference is historical evidence only.

## Feature audit

| Component | Behavior / detection |
|---|---|
| RTCPeerConnection | Constructor presence checked; actual constructor errors reported; empty ICE servers, verified host/host path |
| ICE / connection | Failed/disconnected/closed transitions invalidate the pair; retry requires fresh SDP |
| RTCDataChannel | Reliable ordered mode, ArrayBuffer binary frames, bounded queues, strict validation; no Blob conversion that could reorder messages |
| Typed arrays | Ordinary FP32 ArrayBuffer; default decoder snapshots aliases; exclusive fetch/cache buffers can transfer ownership |
| Workers | Dedicated module Workers; actual loading confirms support; errors/message errors/command deadlines trigger cleanup |
| WASM | Actual scalar/SIMD compile/instantiate determines selection; allocation/kernel failure reports fallback to TypeScript |
| SharedArrayBuffer | Not used or required; no COOP/COEP/shared-memory requirement |
| Cache Storage / SW | Optional for online inference, required for offline preparation; denied/quota/corrupt entries report explicit status |
| IndexedDB | Not used by the app; presence is diagnostic only |
| Camera | Explicit scan button, environment-facing preference, video-only/audio:false; failure retains manual pairing |
| Lifecycle | visibilitychange/pagehide/pageshow; freeze/resume handled where dispatched; no user-agent name branching |

The dashboard displays capability presence separately from actual active backend,
fallback reasons, measured role load, prefill, buffered bytes, WASM linear allocation
and optional page JS heap. API presence is not permission, quota, optical or device
compatibility evidence. Browser/platform strings appear only in exported metadata.

## iOS Safari

Open directly in stock Safari with trusted HTTPS. Module Workers, Web Crypto,
WebRTC binary DataChannel and storage must actually load successfully. Camera
permission may be denied; QR optics/lighting and multi-chunk scanning need real
phone trials. Backgrounding, app switching and lock may suspend JavaScript and
Workers. miniMol cannot force execution during suspension or observe events until
the browser schedules JavaScript again.

Active pairs are deliberately discarded on hidden/freeze/pagehide. Pending manual
offers are preserved while copying text; return BOTH browsers to foreground before
applying the answer/allowing the DataChannel to open. Prefer QR to keep both screens
visible. A channel opening in a hidden page is rejected. This is a conservative
trade-off: less automatic resume, no reuse of uncertain KV state.

## Android Chrome

Use Chrome directly over trusted HTTPS. Chrome may freeze/discard background tabs
or terminate processes under memory pressure; no app API can prevent this. Observed
freeze/resume/visibility events, liveness and Worker timeouts expose recovery state.
Service-worker updates wait for old tabs to close; no forced activation during a
session. Cache/permission/OS memory policies remain device-dependent.

## Recovery semantics

- Main-thread clock watchdog checks a 10-second execution gap using elapsed wall
  and monotonic time. It invalidates ACTIVE work on a detected gap, not manual
  signaling waits. Clock changes can conservatively require a new pair.
- Role messages and outgoing/incoming work are guarded against hidden/stale sessions.
- Worker errors, message decoding/delivery failures and command deadlines invalidate
  the session. Control commands time out at 8 s, attach at 20 s, load at 120 s and
  whole generation at 180 s. Existing per-activation protocol/liveness bounds remain.
- Silent Worker death is detected on the next command/heartbeat deadline; immediate
  OS process-death notification is not guaranteed. Model load may therefore wait
  for its bounded load deadline. Errors instruct a fresh two-role pairing.
- Duplicate generation is rejected on the main thread and by the existing runtime.
  Stop/disconnect is safe cancellation, terminates the Worker and abandons KV state.
- All pending RPCs are rejected, queue senders closed, lifecycle handlers and
  heartbeat/watchdog/drain timers removed. Late Worker callbacks are ignored.
- The peer also invalidates on channel/ICE failure. No unacknowledged step is resumed,
  retried silently or replaced with local six-layer execution.

After recovery: foreground both pages, press Load / retry on BOTH, retain correct
own-Wi-Fi IPv4, exchange NEW offer and answer, wait for verified handshake and run
Hello/8. Expected IDs: [63,119,179,184,253,37,243,172].

## Memory and cleanup

Exact FP32 weights/operations are preserved. Phone 1's raw shard is 22,473,216 bytes;
Phone 2's is 21,689,856. Exclusive fetch/cache buffers transfer ownership before
verification when supported, avoiding the extra decoder snapshot of one whole
shard. No-transfer browsers use the safe copy fallback. A cache response snapshot
is still needed before detaching network bytes; it is committed only AFTER hash,
size, schema and finiteness verification. Default public decoder alias protection
is unchanged. The manifest snapshot no longer requires structuredClone or invokes
untrusted toJSON methods.

WASM still maintains a role-local matrix copy for its separate linear memory;
zero-copy removal would require changing engine representation and was not attempted.
Input/output scratch views are reused safely because the fixed role memory does
not grow after construction. KV allocation remains 4,718,592 bytes per phone and
512-position capacity. Occupied KV and actual WASM allocation are distinct metrics.
No quantization, parameter change or buffer release during valid computation.

Worker termination releases execution/ownership; browser GC/OS decides when RSS
falls. Tests assert resource cleanup and repeated reload correctness, NOT guaranteed
RSS reduction. Page JS heap is optional and not total Worker/WASM/device RAM.
No complete mobile memory figure is invented. Initial load still needs temporary
crypto/cache copies and enough headroom; low-memory failures require retry/scalar
fallback, not a promise to run on every phone.

## WebRTC and offline limits

Host-only ICE can fail with isolated Wi-Fi, blocked UDP/mDNS or local-network policy.
Numeric own-phone addresses avoid name lookup but do not bypass blocked traffic.
Transport adds a bounded 100-ms drain poll when needed, so a missed low-buffer event
does not indefinitely stall a queued send; timers/listeners are removed on close.
All original frame sizes, session IDs, correlation and stale/duplicate validation
remain unchanged. No TURN, central signaling or external activation relay.

Offline caching cannot prevent eviction/private-mode restrictions. Interrupted
transfers are not committed; corrupt cached bytes are rejected and online retry
repairs them. HTTP preparation must finish before claiming cached readiness. A
physical cold reload with WAN/server off but Wi-Fi retained still needs testing.

## Release rollback

The verified M7 release is preserved in release-archives/ under its build ID and
manifest hash. Packaging archives each verified previous release before replacing
it. Archives stay outside the HTTPS root. Verify any recovery copy with:

`node scripts/verify-release.mjs --root release-archives/BUILD-MANIFESTHASH`

Do not delete archives until real device testing is complete. To restore, preserve
the current release first and copy the verified archive back to release/; never
merge versions. The HTTPS helper serves only release/demo or demo-dist.

## Physical checklist still required

Test both actual phones: grant/deny camera; scan all chunks; repeated generation;
background/foreground idle and mid-generation; app switch; screen lock/unlock;
reload paired tab; Worker/memory pressure behavior; denied/evicted/corrupt cache;
interrupted download; WAN-off cold reload; reconnect; and measured mobile benchmark.
Export browser/OS/device versions, both dashboards, exact error/recovery text and
canonical bytes. Keep all physical status rows NOT TESTED until observed.

References: [WebKit power/background behavior](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/),
[Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[W3C visibility](https://www.w3.org/TR/page-visibility-2/).
