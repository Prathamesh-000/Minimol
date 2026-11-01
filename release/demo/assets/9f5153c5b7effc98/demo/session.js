import { PeerPairing } from '../networking/pairing.js';
import { BoundedSender } from '../networking/transport.js';
/** Main thread owns networking only; the role's model and protocol live in a Worker. */
export class DemoSession {
    role;
    debug;
    pairing;
    worker;
    #id = 0;
    #pending = new Map();
    #sender;
    #closed = false;
    #isReady = false;
    get isReady() { return this.#isReady && !this.#closed; }
    #heartbeat;
    #lastIncoming = 0;
    #ready;
    modelReady;
    onLoading;
    onByte;
    onClose;
    constructor(role, debug = false, timeoutMs = 180000) {
        this.role = role;
        this.debug = debug;
        this.worker = new Worker(new URL(`../workers/distributed.worker.js?role=${role}`, import.meta.url), { type: 'module' });
        this.pairing = new PeerPairing(role, timeoutMs);
        this.worker.onmessage = ({ data }) => {
            if (data.kind === 'reply') {
                const pending = this.#pending.get(data.id);
                if (!pending)
                    return;
                clearTimeout(pending.timer);
                this.#pending.delete(data.id);
                data.ok ? pending.resolve(data.result) : pending.reject(new Error(data.error));
            }
            else if (data.kind === 'loading')
                this.onLoading?.(data.message);
            else if (data.kind === 'wire') {
                if (!this.#sender) {
                    this.close('No DataChannel transport');
                    return;
                }
                void this.#sender.send(data.frame).then(() => this.worker.postMessage({ kind: 'ack', wireId: data.wireId })).catch(error => this.close(error.message));
            }
            else if (data.kind === 'closed')
                this.close(data.reason);
            else if (data.kind === 'byte')
                this.onByte?.(data.byte);
        };
        this.worker.onerror = event => this.close(event.message || 'Inference worker failed');
        this.modelReady = this.call('load', { modelBase: new URL('model/', location.href).href, wasmBase: new URL('wasm/', location.href).href });
        void this.modelReady.catch(() => { });
        // Start automatically on both sides, including Phone 2 after displaying its answer.
        this.#ready = this.pairing.connected.then(async (transport) => {
            await this.modelReady;
            if (this.#closed)
                throw new Error('Session closed');
            this.#sender = new BoundedSender(transport, 15000);
            const ready = this.call('attach', { debug });
            transport.subscribe({ message: frame => { this.#lastIncoming = performance.now(); const buffer = frame; this.worker.postMessage({ kind: 'wire', frame: buffer }, [buffer]); },
                writable: () => this.#sender?.flush(), close: reason => this.close(reason) });
            const verified = await ready;
            this.#isReady = true;
            this.#lastIncoming = performance.now();
            this.#heartbeat = setInterval(() => {
                if (performance.now() - this.#lastIncoming > 20000) {
                    this.close('Peer liveness timeout; keep both screens awake and retry pairing');
                    return;
                }
                if (role === 'phone1')
                    void this.call('ping').catch(error => this.close(error.message));
            }, 2000);
            return verified;
        });
        void this.#ready.catch(error => this.close(error.message));
    }
    call(command, args = {}) {
        if (this.#closed)
            return Promise.reject(new Error('Session closed'));
        return new Promise((resolve, reject) => {
            const id = this.#id++, timer = setTimeout(() => this.close('Worker command timeout'), command === 'generate' ? 180000 : 60000);
            this.#pending.set(id, { resolve, reject, timer });
            this.worker.postMessage({ id, command, ...args });
        });
    }
    ready() { return this.#ready; }
    async generate(prompt, count, debug = false) {
        if (this.role !== 'phone1')
            throw new Error('Only Phone 1 generates');
        await this.ready();
        return this.call('generate', { prompt, count, debug });
    }
    close(reason = 'Disconnected. Retry with a fresh offer and answer.') {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#isReady = false;
        clearInterval(this.#heartbeat);
        this.#sender?.close(new Error(reason));
        this.pairing.close(reason);
        this.worker.terminate();
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.#pending.clear();
        this.onClose?.(reason);
    }
}
