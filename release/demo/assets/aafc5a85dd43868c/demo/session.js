import { LifecycleGuard, bindLifecycle } from './lifecycle.js';
import { PeerPairing } from '../networking/pairing.js';
import { BoundedSender } from '../networking/transport.js';
/** Main thread owns networking only; the role's model and protocol live in a Worker. */
export class DemoSession {
    role;
    debug;
    pairing;
    worker;
    #id = 0;
    #workerMessageError = () => this.close('Worker message could not be decoded. Retry both roles and pair again.');
    #pending = new Map();
    #sender;
    #closed = false;
    #isReady = false;
    #generating = false;
    #everPaired = false;
    get wasPaired() { return this.#everPaired; }
    #detachLifecycle;
    #unsubscribe;
    lifecycle = new LifecycleGuard(() => !this.#closed && (this.#isReady || this.#generating || this.pairing?.dataChannel?.readyState === 'open'), reason => this.close(reason));
    get resourceState() { return { closed: this.#closed, generating: this.#generating, pendingCommands: this.#pending.size, heartbeatActive: !!this.#heartbeat, watchdogActive: !!this.#watchdog, lifecycleBound: !!this.#detachLifecycle, workerTerminationRequested: this.#closed, dataChannelBufferedBytes: this.pairing.dataChannel?.bufferedAmount ?? 0 }; }
    get isReady() { return this.#isReady && !this.#closed; }
    #heartbeat;
    #watchdog;
    #lastIncoming = 0;
    #ready;
    modelReady;
    modelInfo;
    lastMeasurement;
    onLoading;
    onByte;
    onClose;
    constructor(role, debug = false, timeoutMs = 180000) {
        this.role = role;
        this.debug = debug;
        if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || typeof Worker !== 'function' || typeof RTCPeerConnection !== 'function')
            throw new Error('Trusted HTTPS, Web Crypto, module Workers and WebRTC are required. Check this browser and retry.');
        this.pairing = new PeerPairing(role, timeoutMs);
        try {
            this.worker = new Worker(new URL(`../workers/distributed.worker.js?role=${role}`, import.meta.url), { type: 'module' });
        }
        catch (error) {
            this.pairing.close('Module Worker construction failed');
            throw new Error('Module Worker unavailable; verify browser support and reload: ' + String(error));
        }
        this.#detachLifecycle = bindLifecycle(this.lifecycle, document, window);
        this.#watchdog = setInterval(() => this.lifecycle.check(), 2000);
        this.worker.onmessage = ({ data }) => {
            if (this.#closed || !this.lifecycle.check())
                return;
            if (document.hidden && (this.#isReady || this.#generating)) {
                this.lifecycle.transition('hidden');
                return;
            }
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
                void this.#sender.send(data.frame).then(() => { if (!this.#closed)
                    this.worker.postMessage({ kind: 'ack', wireId: data.wireId }); }).catch(error => this.close(error.message));
            }
            else if (data.kind === 'closed')
                this.close(data.reason);
            else if (data.kind === 'byte')
                this.onByte?.(data.byte);
        };
        this.worker.onerror = event => this.close((event.message || 'Inference Worker failed; possible memory pressure') + '. Load / retry both phones and pair again.');
        this.worker.addEventListener('messageerror', this.#workerMessageError);
        this.modelReady = this.call('load', { modelBase: new URL('model/', location.href).href, wasmBase: new URL('wasm/', location.href).href }).then(info => { this.modelInfo = info; return info; });
        void this.modelReady.catch(error => this.close('Model load failed: ' + error.message + '. Retry loading the selected role.'));
        // Start automatically on both sides, including Phone 2 after displaying its answer.
        this.#ready = this.pairing.connected.then(async (transport) => {
            await this.modelReady;
            if (this.#closed)
                throw new Error('Session closed');
            this.lifecycle.reset(); // Manual signaling time is not an execution stall.
            this.#sender = new BoundedSender(transport, 15000);
            const ready = this.call('attach', { debug });
            this.#unsubscribe = transport.subscribe({ message: frame => { if (this.#closed || !this.lifecycle.check())
                    return; if (document.hidden) {
                    this.lifecycle.transition('hidden');
                    return;
                } this.#lastIncoming = performance.now(); const buffer = frame; this.worker.postMessage({ kind: 'wire', frame: buffer }, [buffer]); },
                writable: () => this.#sender?.flush(), close: reason => this.close(reason) });
            const verified = await ready;
            if (this.#closed)
                throw new Error('Session closed during handshake');
            this.#isReady = true;
            this.#everPaired = true;
            this.lifecycle.reset();
            if (document.hidden) {
                this.lifecycle.transition('hidden');
                throw new Error('Connection opened in a hidden page; foreground both browsers and pair again');
            }
            this.#lastIncoming = performance.now();
            this.#heartbeat = setInterval(() => {
                if (!this.lifecycle.check())
                    return;
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
        if (this.#closed || !this.lifecycle.check())
            return Promise.reject(new Error('Session closed; Load / retry both phones and pair again'));
        if (this.#pending.size >= 32)
            return Promise.reject(new Error('Too many pending Worker commands'));
        return new Promise((resolve, reject) => {
            const id = this.#id++, timer = setTimeout(() => this.close(`Worker ${command} timeout; it may be paused or terminated. Load / retry BOTH phones and pair again.`), command === 'generate' ? 180000 : command === 'load' ? 120000 : command === 'attach' ? 20000 : 8000);
            this.#pending.set(id, { resolve, reject, timer });
            try {
                this.worker.postMessage({ id, command, ...args });
            }
            catch (error) {
                clearTimeout(timer);
                this.#pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
                this.close('Worker command delivery failed; Load / retry both roles and pair again');
            }
        });
    }
    ready() { return this.#ready; }
    async generate(prompt, count, debug = false) {
        if (this.role !== 'phone1')
            throw new Error('Only Phone 1 generates');
        if (this.#generating)
            throw new Error('A generation is already running');
        if (document.hidden)
            throw new Error('Bring both browser pages to the foreground before generating');
        this.#generating = true;
        try {
            await this.ready();
            this.lastMeasurement = undefined;
            const result = await this.call('generate', { prompt, count, debug });
            this.lastMeasurement = result.benchmark;
            return result;
        }
        finally {
            this.#generating = false;
        }
    }
    close(reason = 'Disconnected. Retry with a fresh offer and answer.') {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#isReady = false;
        this.#generating = false;
        clearInterval(this.#heartbeat);
        this.#heartbeat = undefined;
        clearInterval(this.#watchdog);
        this.#watchdog = undefined;
        this.#detachLifecycle?.();
        this.#detachLifecycle = undefined;
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
        this.#sender?.close(new Error(reason));
        this.pairing.close(reason);
        this.worker.terminate();
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.removeEventListener('messageerror', this.#workerMessageError);
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.#pending.clear();
        this.onClose?.(reason);
    }
}
