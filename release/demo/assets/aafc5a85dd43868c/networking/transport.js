import { MAX_FRAME_BYTES, ProtocolError, ErrorCode } from './protocol.js';
export class BoundedSender {
    transport;
    timeoutMs;
    highWaterBytes;
    maxQueueBytes;
    maxQueueFrames;
    #queue = [];
    #bytes = 0;
    #closed = false;
    #flushing = false;
    metrics = { frames: 0, bytes: 0, backpressureWaits: 0, maxQueuedBytes: 0 };
    constructor(transport, timeoutMs = 5000, highWaterBytes = 16384, maxQueueBytes = 65536, maxQueueFrames = 32) {
        this.transport = transport;
        this.timeoutMs = timeoutMs;
        this.highWaterBytes = highWaterBytes;
        this.maxQueueBytes = maxQueueBytes;
        this.maxQueueFrames = maxQueueFrames;
        if (!(timeoutMs > 0) || highWaterBytes < MAX_FRAME_BYTES || maxQueueBytes < MAX_FRAME_BYTES || maxQueueFrames < 1)
            throw new Error('Invalid backpressure limits');
    }
    send(frame) {
        if (this.#closed || this.transport.readyState !== 'open')
            return Promise.reject(new ProtocolError('Transport closed', ErrorCode.CLOSED));
        if (!(frame instanceof ArrayBuffer) || frame.byteLength > MAX_FRAME_BYTES)
            return Promise.reject(new ProtocolError('Invalid outgoing frame'));
        if (this.#bytes + frame.byteLength > this.maxQueueBytes || this.#queue.length >= this.maxQueueFrames)
            return Promise.reject(new ProtocolError('Send queue limit exceeded', ErrorCode.BACKPRESSURE));
        return new Promise((resolve, reject) => {
            const item = { frame: frame.slice(0), resolve, reject, timer: setTimeout(() => {
                    if (this.#queue.includes(item))
                        this.close(new ProtocolError('Backpressure timeout', ErrorCode.TIMEOUT));
                }, this.timeoutMs) };
            this.#queue.push(item);
            this.#bytes += frame.byteLength;
            this.metrics.maxQueuedBytes = Math.max(this.metrics.maxQueuedBytes, this.#bytes);
            if (this.transport.bufferedAmount + frame.byteLength > this.highWaterBytes)
                this.metrics.backpressureWaits++;
            this.flush();
        });
    }
    flush() {
        if (this.#flushing || this.#closed)
            return;
        this.#flushing = true;
        try {
            while (this.#queue.length && this.transport.readyState === 'open') {
                const item = this.#queue[0];
                if (this.transport.bufferedAmount + item.frame.byteLength > this.highWaterBytes)
                    break;
                this.#queue.shift();
                this.#bytes -= item.frame.byteLength;
                clearTimeout(item.timer);
                const sentBytes = item.frame.byteLength; // Worker transport may detach the buffer synchronously.
                try {
                    this.transport.send(item.frame);
                    this.metrics.frames++;
                    this.metrics.bytes += sentBytes;
                    item.resolve();
                }
                catch (error) {
                    const failure = error instanceof Error ? error : new Error(String(error));
                    item.reject(failure);
                    this.close(failure);
                    break;
                }
            }
        }
        finally {
            this.#flushing = false;
        }
    }
    /** Best-effort diagnostic only; it may not bypass buffering or reorder queued data. */
    tryError(frame) {
        if (!this.#closed && !this.#queue.length && this.transport.readyState === 'open' && this.transport.bufferedAmount + frame.byteLength <= this.highWaterBytes) {
            const sentBytes = frame.byteLength;
            try {
                this.transport.send(frame);
                this.metrics.frames++;
                this.metrics.bytes += sentBytes;
            }
            catch { /* Closing is authoritative when diagnostics cannot be sent. */ }
        }
    }
    close(error) {
        if (this.#closed)
            return;
        this.#closed = true;
        for (const item of this.#queue.splice(0)) {
            clearTimeout(item.timer);
            item.reject(error);
        }
        this.#bytes = 0;
    }
    get queuedBytes() { return this.#bytes; }
}
