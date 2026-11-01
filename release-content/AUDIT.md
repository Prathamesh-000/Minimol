# M7 release audit

## Scope and retained invariants

Reviewed the M1–M6 reports, source/runtime/loaders, caches/Workers, protocol,
pairing, dashboard/benchmark code, test harnesses and build scripts. Exact model
contract and ownership remain unchanged. Weight/repro and full test results are
recorded in VALIDATION_STATUS.md and source MILESTONE_7_REPORT.md.

## Findings

1. Ordinary demo builds retain old asset directories and compiled files. FIXED FOR
   RELEASE: package-release compiles into empty temporary storage and builds an
   empty distribution; verifier rejects stale asset versions. Release compilation omits developer source maps and declaration files so
   machine-specific source paths are not published. The ordinary development build
   retains its debugging assets. Working demo-dist
   stays available, preserving old active sessions during local iteration.
2. Existing output hashing covers JS/HTML/SW/vendor contents but not weight/WASM
   contents. ADDRESSED: release inventory hashes every artifact; independent pinned
   weight checks and pinned WASM checksums and export/import checks gate packaging. The verifier reads
   data schemas from trusted source and does not execute JavaScript from an
   unverified package. WASM is checked against approved hashes before instantiation. Build ID alone is
   not advertised as a complete artifact-integrity digest.
3. No existing release inventory, packaging or non-overwriting reproduction check.
   ADDED: independently verified machine-readable manifest/checksums, negative
   integrity tests and temporary seed-42 regeneration with golden comparison.
4. M1–M6 documents intentionally record historical states, some of which now differ
   from current implementation. Release documents point to current capability and
   explicitly distinguish historical measurements from deferred physical checks.
5. Both local and distributed coordinators, older Worker entry points and dist/
   compatibility copies coexist. RETAINED: these support reference/CPU tests and
   previous APIs. They are not a hidden full-model browser fallback. No unused npm
   package found: TypeScript/Playwright serve build/tests; QR packages are bundled.
6. Cache eviction/quota and role-switch removal are known behavior, not silent
   readiness. Only one active role per browser profile is supported. Interrupted
   downloads are discarded, corrupt cache entries rejected and online retry repairs.
7. QR validation checks bounds, chunks, role, checksum and 15-minute expiry. It does
   not authenticate humans. Manual SDP includes IP/ICE credentials; share only with
   the intended peer. Diagnostic exports include user agent/operator notes and are
   local files, not uploaded. Treat them as user-controlled evidence, not proof.
8. No third-party runtime network request, analytics, cloud API or activation relay
   found in application source. All asset fetches are same-origin; own-IP hint is
   optional and network-only. Library documentation URLs are not network calls.
   Camera is requested only by the explicit scan button, video-only with no audio.
9. HTTPS bootstrap, browser trust, WebRTC DTLS and trusted source are required.
   Strict protocol validation remains unchanged. Text/error display uses textContent.
   SHA-256 detects corruption but an unsigned release is not publisher authentication.
10. Development Python server is for trusted local demos, not hardened public hosting.
    It logs client IP/paths locally. Use a suitable trusted static HTTPS host for
    public deployment. No CA/private key or full weights are in the release.

11. Legacy test harness report paths are overwritten by later runs. M7 added an
    optional report tag to the offline/QR harness so release-specific measurements
    and results can be retained separately. Historical M6 table values remain
    historical; shared legacy artifact paths represent the latest execution.

## Security limitations

No penetration-test or formal security certification claim is made. A malicious
trusted HTTPS host can replace JavaScript/manifest; unsigned checksums cannot
prevent that. Browser/network policies can prevent host-only ICE, which must fail
clearly. Initial HTTPS delivery/dependency installation requires network access;
after verified caching, peer inference needs only a permitted local Wi-Fi path.
Manual QR/text signaling remains operator-mediated; there is no server directory.
