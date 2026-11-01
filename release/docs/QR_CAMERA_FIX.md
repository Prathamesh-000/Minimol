# QR camera recovery — November 1, 2026

The reported iPhone screenshot shows a JSON EOF error when exporting an empty
local answer. That error does not establish whether camera permission was denied.
Phone 2 must scan Phone 1's offer before creating/exporting its own answer.

Changes: empty/incomplete exports now explain the required step; camera access
is requested directly from the Scan tap before asynchronous decoder loading;
encoder and decoder load independently. Permission-request, preview and scanning
status are visible. Denied, missing and busy cameras receive recovery instructions.
The muted inline preview scrolls into view. Stop releases tracks and reports its
state; stale permission responses cannot overwrite the current scan session.
Manual pairing and the existing QR checksum/chunk protocol remain available.

Executed validation: npm test (76 tests before adding the export-error regression);
node --test tests/networking/qrPayload.test.mjs (3 passed, including new regression);
npm run typecheck; npm run build:demo; node scripts/test-mobile-reliability.mjs
(15 desktop scenarios); node scripts/test-milestone5.mjs (12 browser scenarios).
These include desktop fake-camera preview without a local answer, Stop track
cleanup, mocked permission denial, multi-chunk image decoding, offline reload and
real WebRTC golden generation. This is NOT physical iPhone/Android camera evidence.

## Retry on phones

Serve the rebuilt demo using the existing trusted HTTPS certificate. To replace
an older offline shell, tap Prepare offline on the old page, wait for the update
to download, close ALL miniMol tabs and reopen. Confirm the displayed build matches
the newly served index. If the old build persists, clear site data for this origin
and reload online; this requires downloading the assigned shard again.

Open directly in stock Safari or Android Chrome. Phone 1: load its shard, Create
offer, Show QR. Phone 2: load its shard, Scan other phone, allow Camera, scan each
numbered code as Phone 1 advances Next. After Complete QR verified, press Create
answer and Show QR. Phone 1 scans all answer codes and presses Apply answer.
Keep both pages foreground during connection and generation. Camera failure still
allows copying the complete offer and answer through the manual text fields.

If no preview opens, record the exact new qr-status message and browser/device.
The screenshot alone cannot prove a browser-permission or device-camera cause.
