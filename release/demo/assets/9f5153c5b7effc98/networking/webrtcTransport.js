import { MAX_FRAME_BYTES } from './protocol.js';
/** Ordered/reliable DataChannel adapter; queues only the few startup frames. */
export class WebRTCTransport {
    channel;
    #events;
    #early = [];
    #closed = false;
    #reason = 'DataChannel closed';
    constructor(channel) {
        this.channel = channel;
        if (!channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null)
            throw new Error('Reliable ordered DataChannel required');
        channel.binaryType = 'arraybuffer';
        channel.bufferedAmountLowThreshold = 8192;
        channel.addEventListener('message', this.onMessage);
        channel.addEventListener('close', this.onClose);
        channel.addEventListener('error', this.onError);
        channel.addEventListener('bufferedamountlow', this.onWritable);
    }
    get readyState() { return !this.#closed && this.channel.readyState === 'open' ? 'open' : 'closed'; }
    get bufferedAmount() { return this.channel.bufferedAmount; }
    onMessage = (event) => {
        if (this.#closed)
            return;
        const frame = event.data;
        if (!(frame instanceof ArrayBuffer) || frame.byteLength > MAX_FRAME_BYTES || frame.byteLength < 40) {
            this.close('Malformed binary frame');
            return;
        }
        if (this.#events)
            this.#events.message(frame);
        else if (this.#early.length < 8)
            this.#early.push(frame);
        else
            this.close('Startup receive queue overflow');
    };
    onClose = () => this.close('DataChannel closed');
    onError = () => this.close('DataChannel error');
    onWritable = () => this.#events?.writable();
    send(frame) {
        if (this.readyState !== 'open')
            throw new Error('DataChannel is not open');
        if (!(frame instanceof ArrayBuffer) || frame.byteLength < 40 || frame.byteLength > MAX_FRAME_BYTES)
            throw new Error('Invalid binary frame');
        this.channel.send(frame);
    }
    subscribe(events) {
        if (this.#events)
            throw new Error('Transport already subscribed');
        this.#events = events;
        queueMicrotask(() => {
            if (this.#events !== events)
                return;
            if (this.#closed)
                events.close(this.#reason);
            else
                for (const frame of this.#early.splice(0)) {
                    if (this.#closed)
                        break;
                    events.message(frame);
                }
        });
        return () => { if (this.#events === events)
            this.#events = undefined; };
    }
    close(reason) {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#reason = reason;
        this.#early = [];
        this.channel.removeEventListener('message', this.onMessage);
        this.channel.removeEventListener('close', this.onClose);
        this.channel.removeEventListener('error', this.onError);
        this.channel.removeEventListener('bufferedamountlow', this.onWritable);
        this.channel.close();
        this.#events?.close(reason);
    }
}
