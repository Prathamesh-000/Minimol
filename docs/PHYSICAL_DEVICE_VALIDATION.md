# Physical-device evidence checklist

All M6 physical tests below are **NOT TESTED**. User-reported prior two-phone M4
success is historical evidence; device/browser versions and new M6 trials have
not been independently captured. Desktop Chrome evidence is separate.

For EVERY row record: test name, expectation, PASS/FAIL/NOT TESTED, actual observed
behavior, exact error, timestamp, phone model/OS/browser version/build ID, role,
network type and exported JSON/screenshot/video filenames. The in-app panel offers
these scenarios, browser metadata and bounded event history. PASS requires an
operator observation; the app never auto-certifies physical compatibility.

| Test | Expected | iPhone Safari | Android Chrome |
|---|---|---|---|
| iosQR / androidQR | Permission granted, camera reads real screen QR; denial leaves manual pairing | NOT TESTED | NOT TESTED |
| qrAssembly | Every numbered chunk reconstructs complete signaling; duplicate chunks tolerated; mixed exchange rejected | NOT TESTED | NOT TESTED |
| qrValidation | Bad checksum, malformed/expired/wrong-role QR rejected without applying SDP | NOT TESTED | NOT TESTED |
| download | Interrupt shard transfer, no partial commit; retry verifies only assigned shard | NOT TESTED | NOT TESTED |
| corruptCache | Corrupt bytes rejected; online retry repairs; no false offline readiness | NOT TESTED | NOT TESTED |
| offlineReload | With server/WAN unavailable but Wi-Fi retained, cold reload, cached verification and real generation work | NOT TESTED | NOT TESTED |
| pairedReload | Reload ends old session; fresh pairing restores canonical generation | NOT TESTED | NOT TESTED |
| screenResume | Lock/resume exposes observed state; stale/disconnected pair fails safely and fresh pair recovers | NOT TESTED | NOT TESTED |
| reconnect | Disconnect during generation rejects operation; reconnect both roles and regenerate canonical bytes | NOT TESTED | NOT TESTED |
| repeated generation | Three consecutive Hello/8 generations match IDs and reset/advance independent KV correctly | NOT TESTED | NOT TESTED |
| role isolation | Network log shows only assigned .bin; each trace evaluates own three layers per step | NOT TESTED | NOT TESTED |
| performance | Two warmups + five measured real-pair runs exported from both devices; no desktop numbers relabeled mobile | NOT TESTED | NOT TESTED |

Evidence: capture both role dashboards simultaneously (connection, backend,
participation, traffic, KV and bytes), exported JSON from each phone and a short
pairing/generation video. For Hello/8 each engine processes 12 positions, evaluates
36 layers in total and retains 12 KV entries per owned layer. Output IDs are
[63,119,179,184,253,37,243,172]. End-to-end flow must require both devices.

For cache corruption use development tools to alter only the selected cache entry,
then retry online/offline. Do not edit canonical project weight files. For QR expiry
use an expired test payload or wait 15 minutes; do not change phone clocks during
performance measurement. Record optical conditions, denied permissions, Wi-Fi
isolation and any browser suspension. A failed test should remain FAIL with the
original evidence until a documented rerun succeeds.
