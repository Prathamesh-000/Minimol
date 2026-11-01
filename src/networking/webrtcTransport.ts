import { type BinaryTransport } from './transport.js';
import { MAX_FRAME_BYTES } from './protocol.js';

type Events = Parameters<BinaryTransport['subscribe']>[0];
/** Ordered/reliable DataChannel adapter; queues only the few startup frames. */
export class WebRTCTransport implements BinaryTransport {
  #events?: Events;
  #early: ArrayBuffer[] = [];
  #closed = false;
  #drainPoll?: ReturnType<typeof setInterval>;
  #reason = 'DataChannel closed';
  constructor(readonly channel: RTCDataChannel) {
    if (!channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) throw new Error('Reliable ordered DataChannel required');
    channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 8192;
    channel.addEventListener('message', this.onMessage);
    channel.addEventListener('close', this.onClose);
    channel.addEventListener('error', this.onError);
    channel.addEventListener('bufferedamountlow', this.onWritable);
  }
  get readyState(): 'open' | 'closed' { return !this.#closed && this.channel.readyState === 'open' ? 'open' : 'closed'; }
  get bufferedAmount(): number { return this.channel.bufferedAmount; }
  private onMessage = (event: MessageEvent) => {
    if (this.#closed) return;
    const frame = event.data;
    if (!(frame instanceof ArrayBuffer) || frame.byteLength > MAX_FRAME_BYTES || frame.byteLength < 40) { this.close('Malformed binary frame'); return; }
    if (this.#events) this.#events.message(frame);
    else if (this.#early.length < 8) this.#early.push(frame);
    else this.close('Startup receive queue overflow');
  };
  private onClose = () => this.close('DataChannel closed');
  private onError = () => this.close('DataChannel error');
  private onWritable = () => this.#events?.writable();
  send(frame: ArrayBuffer): void {
    if (this.readyState !== 'open') throw new Error('DataChannel is not open');
    if (!(frame instanceof ArrayBuffer) || frame.byteLength < 40 || frame.byteLength > MAX_FRAME_BYTES) throw new Error('Invalid binary frame');
    this.channel.send(frame);
    if (!this.#drainPoll && this.channel.bufferedAmount > this.channel.bufferedAmountLowThreshold) {
      this.#drainPoll = setInterval(() => {
        if (this.readyState !== 'open') { this.close('DataChannel no longer open'); return; }
        if (this.channel.bufferedAmount <= this.channel.bufferedAmountLowThreshold) { clearInterval(this.#drainPoll); this.#drainPoll = undefined; this.onWritable(); }
      }, 100);
    }
  }
  subscribe(events: Events): () => void {
    if (this.#events) throw new Error('Transport already subscribed');
    this.#events = events;
    queueMicrotask(() => {
      if (this.#events !== events) return;
      if (this.#closed) events.close(this.#reason);
      else for (const frame of this.#early.splice(0)) { if (this.#closed) break; events.message(frame); }
    });
    return () => { if (this.#events === events) this.#events = undefined; };
  }
  close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true; this.#reason = reason; this.#early = []; clearInterval(this.#drainPoll); this.#drainPoll = undefined;
    this.channel.removeEventListener('message', this.onMessage); this.channel.removeEventListener('close', this.onClose);
    this.channel.removeEventListener('error', this.onError); this.channel.removeEventListener('bufferedamountlow', this.onWritable);
    const events = this.#events; this.#events = undefined; this.channel.close(); events?.close(reason);
  }
}
