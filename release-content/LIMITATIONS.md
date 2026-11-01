# Honest limitations

- Randomly initialized, untrained model; no meaningful natural-language claim.
- 256 byte IDs, 512-position context, exactly six layers and fixed two-role split.
- One in-flight inference exchange; no automatic continuation of uncertain KV state.
- TS fallback and optional WASM linear kernels; not a complete C++ engine.
- WebRTC host-only connectivity depends on browser/local network; no TURN/STUN fallback.
- Cache eviction, private mode, denied storage/camera and background suspension matter.
- Download retries restart from the beginning; no HTTP range resume.
- QR requires all chunks, acceptable lighting and reasonable clocks; manual fallback remains.
- QR/checksum validation is not human authentication; release SHA-256 is not a signature.
- Explicit own-phone IP signaling reveals that local IP to the chosen peer. SDP
  contains ephemeral ICE credentials/fingerprint. Do not post live SDP publicly.
- Diagnostic exports may contain user-agent, device notes, timings and test results.
  They are local downloads; review before sharing. No analytics collects them.
- Static HTTPS bootstrap and optional camera permission are needed. Local Wi-Fi
  remains needed after caching. External dependency/tool downloads are build-time only.
- All six deferred physical tests in VALIDATION_STATUS.md remain NOT TESTED.
- Exact weight reproducibility is checked on the pinned environment; Python and
  machine descriptive metadata may differ. Cross-platform floating math uses the
  original tolerances and exact greedy-ID agreement, not a universal bitwise promise.

M8: active pairs are discarded on hidden/freeze/pagehide or stale execution gaps.
Pending manual offers survive copying, but both pages must be foregrounded when
the channel opens. No background execution or automatic KV continuation is promised.
See docs/MOBILE_COMPATIBILITY.md. Prior releases are retained in release-archives/
outside the web root. Reported memory is partial; browser GC/RSS is not guaranteed.
