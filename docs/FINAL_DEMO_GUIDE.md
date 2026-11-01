# miniMol final demo guide

Use the existing project. It requires Node/npm for building, the existing generated
FP32 shards, and a certificate trusted by both phones. Python only serves files.

## Build and serve

```bash
cd /Users/vikrantsaini/Documents/miniMol
npm ci
npm run build:demo
python3 -B scripts/serve-demo.py \
  --cert /private/tmp/minimol-https/cert.pem \
  --key /private/tmp/minimol-https/key.pem
```

Stop the previous server with Ctrl+C before binding port 8443. Run `ipconfig
getifaddr en0` to check the Mac's Wi-Fi IP. The existing certificate covers
10.10.203.5; if that changes, regenerate with mkcert for the new IP:

```bash
mkcert -cert-file /private/tmp/minimol-https/cert.pem \
  -key-file /private/tmp/minimol-https/key.pem NEW_MAC_IP localhost 127.0.0.1
```

Open `https://10.10.203.5:8443/` while that is the correct Mac IP. Serve only demo-dist.
Never serve repository full weights or certificate private keys.

## iPhone and Android

Install the local CA's public root certificate through a trusted transfer. On
 iPhone install the profile and enable full trust under Settings → General →
About → Certificate Trust Settings. On Android install the CA through Settings'
certificate/security controls (paths vary by vendor). Never transfer rootCA-key.pem
or the HTTPS server key. Open the URL directly in Safari or Android Chrome,
with no certificate warning, on the same non-isolated Wi-Fi. Keep both screens awake.

Choose Phone 1 on one device, Phone 2 on the other. Load each assigned shard.
Phone 1 owns embeddings/0–2; Phone 2 owns 3–5/final norm/head. Wait for verification.
Only one miniMol role/tab per browser profile is supported.

## Offline preparation and pairing

1. Press Prepare offline shell on each device; wait for shell and shard caching.
   This is preparation, not proof of physical offline reload.
2. Verify THIS phone's Wi-Fi IPv4 against its Wi-Fi settings. Use that numeric
   address for direct pairing; do not enter the Mac's IP or the other phone's IP.
3. Phone 1 creates an offer and presses Show QR. Phone 2 scans every numbered
   code using Scan other phone, granting camera permission. Advance Next code
   on Phone 1 as chunks are received. After completion press Create answer.
4. Phone 2 displays the answer QR codes; Phone 1 scans all, then presses Apply
   answer. Manual text copy/paste remains available without camera permission.
5. Wait for the verified direct host path and model handshake on both screens.
6. On Phone 1 generate Hello with 8 new bytes. Expected IDs:
   `[63,119,179,184,253,37,243,172]`. Phone 2 executes its half automatically.
   These untrained bytes need not be meaningful English.

## Validation and benchmarks

Expand Physical validation and benchmark evidence. Choose the real environment
classification and scenario, read its expectation, record actual observations
and device model before marking PASS or FAIL, then export JSON from BOTH devices.
Default status is NOT TESTED. Browser information and observed events are included;
manual PASS is operator evidence, not automated device certification.

Run Benchmark real pair on Phone 1 only. It uses Hello / 8 bytes, two warmups and
five measured runs, checking canonical IDs each time. Export JSON after completion.
Model loading time, prefill-to-first-byte, each position's compute/round-trip,
full duration and throughput are recorded. RTT includes remote compute;
RTT minus reported remote compute includes queues/serialization/scheduling and
must not be called pure network latency. Independent one-way latency is unavailable.
JS heap memory is optional; KV allocation is measured separately.

For offline testing, retain Wi-Fi but disable upstream Internet, stop the Mac
asset server, reload both cached URLs, load each remembered role and pair afresh.
Capture success/failure and outputs. A page that merely stays open does not prove
cached reload. Screen lock, tab reload or uncertain interruption may invalidate
KV state; retry both roles with a new offer/answer, never reuse an old answer.

## Troubleshooting and updates

- ICE stays checking: verify phone IPs, foreground browsers, local-network permission
  where exposed, and non-guest Wi-Fi. Try a compatible hotspot if peer UDP is blocked.
  There is no TURN/STUN/relay fallback.
- Camera denied/no QR: use manual text. Scan all chunks; stop/restart for a new
  exchange. QR codes expire after 15 minutes; phone clocks must be reasonable.
- Cached shard damaged: reconnect the asset server and retry loading; corrupt
  bytes are removed, never executed. Interrupted downloads restart from the beginning.
- Storage denied/evicted: reconnect, reload role and reprepare shell. Private mode
  and OS eviction can remove cached assets. Persistence requests are best effort.
- Resume/reload while paired: check Last error and live peer/channel states; reset
  both roles if closed. Visibility events cannot identify screen lock versus tab switch.
- Update cached code: reconnect server, prepare/check shell, close ALL miniMol tabs,
  then reopen. Updates deliberately wait instead of replacing an active session.
