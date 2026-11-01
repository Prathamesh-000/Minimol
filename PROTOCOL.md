# miniMol binary protocol v1

The codec in `src/networking/protocol.ts` is shared by the distributed runtimes.
Each reliable ordered transport delivers one complete ArrayBuffer per message.
Every integer and float is explicitly little-endian. No JSON tensor encoding,
fragmentation, retransmission or full-model fallback exists. Maximum frame size
is 2,048 bytes; oversize, nonbinary, malformed, stale or unexpected frames fail
the connection and reset its caches.

## Fixed 40-byte header

| Byte offset | Type | Field |
| --- | --- | --- |
| 0 | u32 | Magic bytes `MMIF` |
| 4 | u16 | Protocol version: 1 |
| 6 | u8 | Message type |
| 7 | u8 | Flags; bit 0 permits debug logits only on ACTIVATION/NEXT_BYTE |
| 8 | u32 | Exact payload byte count |
| 12 | 16 bytes | Random nonzero connection identity selected by Phone 1 |
| 28 | u32 | Generation ID |
| 32 | u32 | Request ID |
| 36 | u16 | Position 0–511, or 65535 for control messages |
| 38 | u16 | Reserved, must be zero |

HELLO and READY use generation/request IDs zero. All requests have nonzero IDs,
strictly increasing across generations. START advances generation by exactly one.
IDs never wrap; exhaustion requires a fresh connection. Responses must match
connection, generation, request, position, expected type and flags exactly.

## Message bodies

| Type/value | Payload |
| --- | --- |
| HELLO / 1 | Role u8, dtype u8 (1 = FP32), hidden/vocabulary/context u16 each, capabilities u32, config SHA-256 32 bytes, role-shard SHA-256 32 bytes, model ID byte length u16, reserved u16 zero, ASCII model ID 1–64 bytes |
| READY / 2 | Empty |
| START / 3, STARTED / 4 | Empty; resets the generation and both caches through an acknowledged request |
| ACTIVATION / 5 | Exactly 384 finite FP32 values / 1,536 bytes |
| NEXT_BYTE / 6 | Byte ID u8, seven reserved zero bytes, Phone 2 local duration f64; optionally 256 finite FP32 debug logits |
| STOP / 7 | Reason u8 (0–2) and three reserved zero bytes |
| STOPPED / 8 | Empty acknowledgment |
| ERROR / 9 | Error code u16 (1–7), UTF-8 byte length u16, text up to 256 bytes |
| PING / 10, PONG / 11 | Eight-byte nonce, echoed exactly |

Normal ACTIVATION frames are 1,576 bytes; normal NEXT_BYTE frames are 56 bytes.
Debug NEXT_BYTE frames are 1,080 bytes. Both peers must advertise debug capability,
and each activation must explicitly request it. Normal operation returns no logits.
Compute durations must be finite/nonnegative and describe one local clock only.
PING RTT uses elapsed time on Phone 1; unrelated device clocks are never compared.

## Handshake and execution

Phone 1 sends HELLO. Phone 2 validates its opposite role, exact model/configuration,
dimensions, dtype and expected shard hash, then sends HELLO and READY. Phone 1
validates and sends READY. Each endpoint becomes ready only after receiving the
peer HELLO and READY and sending its own READY. Handshake has a deadline.

Phone 1 sends START and waits for STARTED. It then computes its three layers for
one input byte, sends ACTIVATION and waits for NEXT_BYTE. Phone 2 computes only
its three layers, final norm and head. Both preserve their independent caches.
Every prefill/feedback position follows this exchange. One inference request is
in flight at a time; duplicate requests are errors, never instructions to compute
twice. Successful completion retains caches for inspection; the next START resets
them. Graceful STOP acknowledges and resets both caches.

Timeout, malformed input, response mismatch, compute failure or uncertain
interruption invalidates the connection. An activation is never automatically
retried because the peer may already have updated its cache. Both runtimes reset;
recovery requires a new transport and handshake. Best-effort ERROR delivery may
be lost during closure; closure and rejection remain authoritative. Cancellation
during generation closes the connection to avoid partial-cache reuse.

## Transport contract and backpressure

`BinaryTransport` exposes readyState, bufferedAmount, send, close and subscriptions
for message/close/writable events. Send owns/copies its frame. `BoundedSender`
waits above a 16 KiB high-water mark, queues at most 32 frames / 64 KiB, preserves
order, and applies a send deadline. Overflow rejects explicitly. A stalled send
or send exception rejects the entire pending queue rather than continuing after
a missing frame. Incoming queues are capped at eight frames / 16 KiB.

The M3 Node adapter uses process IPC with advanced binary serialization; its
callbacks account for bytes buffered by IPC writes. A development broker forwards
opaque frames between two processes and may inject faults only during tests.
It performs no inference. No transport server is part of the production library.

For M4, a reliable ordered RTCDataChannel adapter must map send/bufferedAmount,
binaryType=arraybuffer, bufferedamountlow and close/error events to this same
contract. That adapter, signaling and physical connectivity are intentionally
pending. This protocol's SHA-256 checks establish model compatibility/integrity;
they do not authenticate a person's identity or replace transport security.
