import { MAX_FRAME_BYTES, ProtocolError, ErrorCode } from './protocol.js';

/** A future ordered/reliable DataChannel adapter implements this exact contract.
 * An open transport owns/copies sent frames; onWritable fires as buffering falls.
 * No WebRTC or network backend is selected by this module.
 */
export interface BinaryTransport {
  readonly readyState: 'open' | 'closed';
  readonly bufferedAmount: number;
  send(frame: ArrayBuffer): void;
  close(reason: string): void;
  subscribe(events: { message: (data: unknown) => void; close: (reason: string) => void; writable: () => void }): () => void;
}
interface Queued { frame: ArrayBuffer; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export class BoundedSender {
  readonly #queue: Queued[] = [];
  #bytes = 0;
  #closed = false;
  #flushing = false;
  readonly metrics = { frames: 0, bytes: 0, backpressureWaits: 0, maxQueuedBytes: 0 };
  constructor(readonly transport: BinaryTransport, readonly timeoutMs = 5000,
    readonly highWaterBytes = 16384, readonly maxQueueBytes = 65536, readonly maxQueueFrames = 32) {
    if (!(timeoutMs > 0) || highWaterBytes < MAX_FRAME_BYTES || maxQueueBytes < MAX_FRAME_BYTES || maxQueueFrames < 1) throw new Error('Invalid backpressure limits');
  }
  send(frame: ArrayBuffer): Promise<void> {
    if (this.#closed || this.transport.readyState !== 'open') return Promise.reject(new ProtocolError('Transport closed', ErrorCode.CLOSED));
    if (!(frame instanceof ArrayBuffer) || frame.byteLength > MAX_FRAME_BYTES) return Promise.reject(new ProtocolError('Invalid outgoing frame'));
    if (this.#bytes + frame.byteLength > this.maxQueueBytes || this.#queue.length >= this.maxQueueFrames) return Promise.reject(new ProtocolError('Send queue limit exceeded', ErrorCode.BACKPRESSURE));
    return new Promise((resolve, reject) => {
      const item: Queued = { frame: frame.slice(0), resolve, reject, timer: setTimeout(() => {
        if (this.#queue.includes(item)) this.close(new ProtocolError('Backpressure timeout', ErrorCode.TIMEOUT));
      }, this.timeoutMs) };
      this.#queue.push(item); this.#bytes += frame.byteLength;
      this.metrics.maxQueuedBytes = Math.max(this.metrics.maxQueuedBytes, this.#bytes);
      if (this.transport.bufferedAmount + frame.byteLength > this.highWaterBytes) this.metrics.backpressureWaits++;
      this.flush();
    });
  }
  flush(): void {
    if (this.#flushing || this.#closed) return;
    this.#flushing = true;
    try {
      while (this.#queue.length && this.transport.readyState === 'open') {
        const item = this.#queue[0];
        if (this.transport.bufferedAmount + item.frame.byteLength > this.highWaterBytes) break;
        this.#queue.shift(); this.#bytes -= item.frame.byteLength; clearTimeout(item.timer);
        const sentBytes = item.frame.byteLength; // Worker transport may detach the buffer synchronously.
        try { this.transport.send(item.frame); this.metrics.frames++; this.metrics.bytes += sentBytes; item.resolve(); }
        catch (error) { const failure = error instanceof Error ? error : new Error(String(error)); item.reject(failure); this.close(failure); break; }
      }
    } finally { this.#flushing = false; }
  }
  /** Best-effort diagnostic only; it may not bypass buffering or reorder queued data. */
  tryError(frame: ArrayBuffer): void {
    if (!this.#closed && !this.#queue.length && this.transport.readyState === 'open' && this.transport.bufferedAmount + frame.byteLength <= this.highWaterBytes) {
      const sentBytes = frame.byteLength;
      try { this.transport.send(frame); this.metrics.frames++; this.metrics.bytes += sentBytes; } catch { /* Closing is authoritative when diagnostics cannot be sent. */ }
    }
  }
  close(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const item of this.#queue.splice(0)) { clearTimeout(item.timer); item.reject(error); }
    this.#bytes = 0;
  }
  get queuedBytes(): number { return this.#bytes; }
}
