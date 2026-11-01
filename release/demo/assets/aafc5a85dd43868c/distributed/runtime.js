import { Phone1Engine } from '../inference/phone1Engine.js';
import { Phone2Engine } from '../inference/phone2Engine.js';
import { MODEL_CONFIG, CONFIG_SHA256, ROLE_COUNTS, assertByte, assertPosition } from '../inference/modelConfig.js';
import { validateManifest } from '../inference/modelManifest.js';
import { BoundedSender } from '../networking/transport.js';
import { DEBUG_LOGITS, ErrorCode, HEADER_BYTES, MAX_FRAME_BYTES, MessageType as T, NO_POSITION, ProtocolError, decodeMessage, encodeMessage, newConnectionId } from '../networking/protocol.js';
/** Exactly one verified engine lives here. Phone 1 coordinates requests; Phone 2
 * answers through the same transport-neutral binary protocol. No full-model path.
 */
export class DistributedRuntime {
    engine;
    transport;
    options;
    role;
    #manifest;
    #sender;
    #ready;
    #resolveReady;
    #rejectReady;
    #unsubscribe;
    #incoming = [];
    #incomingBytes = 0;
    #processing = false;
    #started = false;
    #state = 'NEW';
    #connectionId;
    #generation = 0;
    #nextRequest = 1;
    #lastPeerRequest = 0;
    #gotHello = false;
    #gotReady = false;
    #sentReady = false;
    #debug = false;
    #busy = false;
    #pending;
    #handshakeTimer;
    #failure;
    #trace = [];
    #counts = { localSteps: 0, localLayerEvaluations: 0, receivedFrames: 0, receivedBytes: 0 };
    #timeoutMs;
    constructor(engine, transport, manifest, options = {}) {
        this.engine = engine;
        this.transport = transport;
        this.options = options;
        if (!(engine instanceof Phone1Engine) && !(engine instanceof Phone2Engine))
            throw new Error('A verified role engine is required');
        this.role = engine instanceof Phone1Engine ? 'phone1' : 'phone2';
        this.#manifest = validateManifest(manifest);
        if (engine.parameterCount !== ROLE_COUNTS[this.role] || engine.shardHash !== this.#manifest.files[this.role].sha256)
            throw new Error('Local shard identity mismatch');
        this.#timeoutMs = options.timeoutMs ?? 10000;
        if (!(this.#timeoutMs > 0) || !Number.isFinite(this.#timeoutMs))
            throw new Error('Invalid request timeout');
        this.#connectionId = this.role === 'phone1' ? newConnectionId() : undefined;
        this.#sender = new BoundedSender(transport, options.sendTimeoutMs ?? this.#timeoutMs);
        this.#ready = new Promise((resolve, reject) => { this.#resolveReady = resolve; this.#rejectReady = reject; });
        // A peer may fail before its caller awaits ready; retain the rejection safely.
        void this.#ready.catch(() => { });
        this.#unsubscribe = transport.subscribe({ message: data => this.receive(data),
            close: reason => this.fail(new ProtocolError(`Transport closed: ${reason}`, ErrorCode.CLOSED), false),
            writable: () => this.#sender.flush() });
    }
    get state() { return this.#state; }
    get busy() { return this.#busy; }
    get stats() {
        return { role: this.role, state: this.#state, connectionId: this.#connectionId, generation: this.#generation,
            debugNegotiated: this.#debug, pendingRequests: this.#pending ? 1 : 0, sendQueuedBytes: this.#sender.queuedBytes,
            ...this.#counts, send: { ...this.#sender.metrics }, engine: this.engine.stats,
            parameterCount: this.engine.parameterCount, shardHash: this.engine.shardHash,
            trace: this.#trace.map(t => ({ ...t, layerIds: [...t.layerIds], cacheBefore: [...t.cacheBefore], cacheAfter: [...t.cacheAfter] })),
            failure: this.#failure?.message };
    }
    start() {
        if (!this.#started && !this.terminal()) {
            this.#started = true;
            this.#state = 'HANDSHAKING';
            this.#handshakeTimer = setTimeout(() => this.fail(new ProtocolError('HELLO/READY timeout', ErrorCode.TIMEOUT)), this.options.handshakeTimeoutMs ?? this.#timeoutMs);
            if (this.role === 'phone1')
                void this.send(this.hello()).catch(error => this.fail(error));
            void this.pump();
        }
        return this.#ready;
    }
    terminal() { return this.#state === 'FAILED' || this.#state === 'CLOSED'; }
    ensureLive() { if (this.terminal())
        throw this.#failure ?? new ProtocolError('Runtime closed', ErrorCode.CLOSED); }
    header(type, requestId = 0, position = NO_POSITION, flags = 0) {
        if (!this.#connectionId)
            throw new ProtocolError('No connection identity', ErrorCode.STATE);
        return { type, connectionId: this.#connectionId, generation: type === T.HELLO || type === T.READY ? 0 : this.#generation, requestId, position, flags };
    }
    hello() {
        return { ...this.header(T.HELLO), hello: { role: this.role, hidden: 384, vocabulary: 256, context: 512, dtype: 'float32',
                capabilities: this.options.allowDebug ? DEBUG_LOGITS : 0, configHash: CONFIG_SHA256,
                shardHash: this.engine.shardHash, modelId: MODEL_CONFIG.model_id } };
    }
    send(message) { this.ensureLive(); return this.#sender.send(encodeMessage(message)); }
    checkReady() {
        if (this.#gotHello && this.#gotReady && this.#sentReady) {
            clearTimeout(this.#handshakeTimer);
            this.#state = 'READY';
            this.#resolveReady();
        }
    }
    receive(data) {
        if (this.terminal())
            return;
        if (!(data instanceof ArrayBuffer) || data.byteLength < HEADER_BYTES || data.byteLength > MAX_FRAME_BYTES) {
            this.fail(new ProtocolError('Invalid incoming frame size/type'));
            return;
        }
        if (this.#incoming.length >= 8 || this.#incomingBytes + data.byteLength > 16384) {
            this.fail(new ProtocolError('Receive queue limit exceeded', ErrorCode.BACKPRESSURE));
            return;
        }
        this.#incoming.push(data.slice(0));
        this.#incomingBytes += data.byteLength;
        this.#counts.receivedFrames++;
        this.#counts.receivedBytes += data.byteLength;
        if (this.#started)
            void this.pump();
    }
    async pump() {
        if (this.#processing || !this.#started || this.terminal())
            return;
        this.#processing = true;
        try {
            while (this.#incoming.length && !this.terminal()) {
                const frame = this.#incoming.shift();
                this.#incomingBytes -= frame.byteLength;
                await this.handle(decodeMessage(frame));
            }
        }
        catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
        }
        finally {
            this.#processing = false;
        }
    }
    async handle(m) {
        if (!this.#connectionId && m.type === T.HELLO && this.role === 'phone2')
            this.#connectionId = m.connectionId;
        if (m.connectionId !== this.#connectionId)
            throw new ProtocolError('Connection identity mismatch');
        if (m.type === T.ERROR) {
            this.fail(new ProtocolError(`Peer error: ${m.errorMessage}`, m.errorCode), false);
            return;
        }
        if (m.type === T.HELLO) {
            if (this.#gotHello || this.#state !== 'HANDSHAKING')
                throw new ProtocolError('Duplicate/unexpected HELLO', ErrorCode.STATE);
            const peer = this.role === 'phone1' ? 'phone2' : 'phone1', h = m.hello;
            if (h.role !== peer || h.hidden !== 384 || h.vocabulary !== 256 || h.context !== 512 || h.dtype !== 'float32'
                || h.modelId !== MODEL_CONFIG.model_id || h.configHash !== CONFIG_SHA256 || h.shardHash !== this.#manifest.files[peer].sha256) {
                throw new ProtocolError('Incompatible peer role/model/configuration/shard', ErrorCode.INCOMPATIBLE);
            }
            this.#gotHello = true;
            this.#debug = !!(this.options.allowDebug && h.capabilities & DEBUG_LOGITS);
            if (this.role === 'phone2')
                await this.send(this.hello());
            await this.send(this.header(T.READY));
            this.#sentReady = true;
            this.checkReady();
            return;
        }
        if (m.type === T.READY) {
            if (!this.#gotHello || this.#gotReady || this.#state !== 'HANDSHAKING')
                throw new ProtocolError('Unexpected READY', ErrorCode.STATE);
            this.#gotReady = true;
            this.checkReady();
            return;
        }
        if (!this.#gotReady || !this.#sentReady)
            throw new ProtocolError('Both verified peers must be READY', ErrorCode.STATE);
        if (this.role === 'phone1') {
            this.correlate(m);
            return;
        }
        if (![T.START, T.ACTIVATION, T.STOP, T.PING].includes(m.type))
            throw new ProtocolError('Message not permitted for Phone 2');
        if (m.requestId <= this.#lastPeerRequest)
            throw new ProtocolError('Duplicate or stale request ID');
        this.#lastPeerRequest = m.requestId;
        if (m.type === T.START) {
            if (m.generation !== this.#generation + 1)
                throw new ProtocolError('Expected next generation');
            this.engine.reset();
            this.#trace = [];
            this.#generation = m.generation;
            this.#state = 'ACTIVE';
            await this.send({ ...m, type: T.STARTED });
            return;
        }
        if (m.generation !== this.#generation)
            throw new ProtocolError('Stale or future generation');
        if (m.type === T.PING) {
            await this.send({ ...m, type: T.PONG });
            return;
        }
        if (this.#state !== 'ACTIVE')
            throw new ProtocolError('Generation is not active', ErrorCode.STATE);
        if (m.type === T.STOP) {
            this.engine.reset();
            this.#state = 'READY';
            await this.send({ ...m, type: T.STOPPED });
            return;
        }
        if (m.flags === DEBUG_LOGITS && !this.#debug)
            throw new ProtocolError('Debug logits were not negotiated');
        const engine = this.engine;
        if (m.position !== engine.position)
            throw new ProtocolError('Unexpected activation position');
        const before = engine.stats, start = performance.now();
        let result;
        try {
            result = engine.step(m.activation, m.position, m.flags === DEBUG_LOGITS);
        }
        catch {
            throw new ProtocolError('Phone 2 inference failed', ErrorCode.COMPUTE);
        }
        const computeMs = performance.now() - start;
        this.record(m, before, computeMs);
        await this.send({ ...this.header(T.NEXT_BYTE, m.requestId, m.position, m.flags), byte: result.byte, computeMs, logits: result.logits });
    }
    record(message, before, computeMs) {
        const after = this.engine.stats, delta = after.layerEvaluations - before.layerEvaluations;
        if (delta !== 3 || after.position !== message.position + 1 || after.cacheLengths.some(n => n !== after.position))
            throw new ProtocolError('Local participation invariant failed', ErrorCode.COMPUTE);
        this.#counts.localSteps++;
        this.#counts.localLayerEvaluations += delta;
        this.#trace.push({ role: this.role, generation: message.generation, requestId: message.requestId, position: message.position,
            layerIds: [...this.engine.layerIds], layerEvaluations: delta, cacheBefore: before.cacheLengths, cacheAfter: after.cacheLengths, computeMs });
    }
    engineStats() { return this.engine.stats; }
    correlate(m) {
        const pending = this.#pending;
        if (!pending || m.requestId !== pending.message.requestId || m.generation !== pending.message.generation
            || m.position !== pending.message.position || m.type !== pending.expected || m.flags !== pending.message.flags)
            throw new ProtocolError('Uncorrelated, duplicate or stale response');
        if (m.type === T.PONG && !m.nonce.every((v, i) => v === pending.message.nonce[i]))
            throw new ProtocolError('PING nonce mismatch');
        clearTimeout(pending.timer);
        this.#pending = undefined;
        pending.resolve(m);
    }
    request(message, expected) {
        this.ensureLive();
        if (this.#pending)
            throw new ProtocolError('Only one request may be in flight', ErrorCode.STATE);
        return new Promise((resolve, reject) => {
            this.#pending = { message, expected, resolve, reject, timer: setTimeout(() => this.fail(new ProtocolError(`Request ${message.requestId} timed out`, ErrorCode.TIMEOUT)), this.#timeoutMs) };
            try {
                void this.send(message).catch(error => this.fail(error));
            }
            catch (error) {
                this.fail(error);
            }
        });
    }
    id() {
        if (this.#nextRequest > 0xffffffff) {
            this.fail(new ProtocolError('Request IDs exhausted; reconnect'));
            this.ensureLive();
        }
        return this.#nextRequest++;
    }
    async exclusive(action) {
        if (this.role !== 'phone1')
            throw new ProtocolError('Only Phone 1 coordinates requests', ErrorCode.STATE);
        if (this.#busy)
            throw new ProtocolError('Another request is in flight', ErrorCode.STATE);
        this.ensureLive();
        this.#busy = true;
        try {
            await this.start();
            this.ensureLive();
            return await action();
        }
        finally {
            this.#busy = false;
        }
    }
    async begin() {
        return this.exclusive(async () => {
            if (this.#generation === 0xffffffff)
                throw new ProtocolError('Generation IDs exhausted; reconnect');
            this.engine.reset();
            this.#trace = [];
            this.#generation++;
            this.#state = 'STARTING';
            await this.request(this.header(T.START, this.id()), T.STARTED);
            this.ensureLive();
            this.#state = 'ACTIVE';
        });
    }
    async step(byte, position, debug = false) {
        assertByte(byte);
        assertPosition(position);
        return this.exclusive(async () => {
            if (this.#state !== 'ACTIVE' || position !== this.engine.position)
                throw new ProtocolError('Invalid generation state/position', ErrorCode.STATE);
            if (debug && !this.#debug)
                throw new ProtocolError('Debug mode was not negotiated', ErrorCode.STATE);
            const message = this.header(T.ACTIVATION, this.id(), position, debug ? DEBUG_LOGITS : 0);
            const before = this.engine.stats, start = performance.now();
            let activation;
            try {
                activation = this.engine.step(byte, position);
            }
            catch {
                this.fail(new ProtocolError('Phone 1 inference failed', ErrorCode.COMPUTE));
                this.ensureLive();
                throw new Error('unreachable');
            }
            const phone1ComputeMs = performance.now() - start;
            message.activation = activation;
            this.record(message, before, phone1ComputeMs);
            const sent = performance.now(), response = await this.request(message, T.NEXT_BYTE);
            this.ensureLive();
            return { byte: response.byte, position, requestId: message.requestId, generation: this.#generation,
                phone1ComputeMs, phone2ComputeMs: response.computeMs, roundTripMs: performance.now() - sent,
                ...(debug ? { activation, logits: response.logits } : {}) };
        });
    }
    async stop(reason = 0) {
        if (!Number.isInteger(reason) || reason < 0 || reason > 2)
            throw new ProtocolError('Invalid stop reason');
        return this.exclusive(async () => {
            if (this.#state !== 'ACTIVE')
                throw new ProtocolError('No generation to stop', ErrorCode.STATE);
            this.#state = 'STOPPING';
            await this.request({ ...this.header(T.STOP, this.id()), stopReason: reason }, T.STOPPED);
            this.ensureLive();
            this.engine.reset();
            this.#state = 'READY';
        });
    }
    async ping() {
        return this.exclusive(async () => {
            const start = performance.now();
            await this.request({ ...this.header(T.PING, this.id()), nonce: crypto.getRandomValues(new Uint8Array(8)) }, T.PONG);
            return performance.now() - start;
        });
    }
    abort() { this.fail(new ProtocolError('Generation interrupted; reconnect before reuse', ErrorCode.CLOSED)); }
    close() { this.fail(new ProtocolError('Runtime closed', ErrorCode.CLOSED), false, 'CLOSED'); }
    fail(reason, notify = true, state = 'FAILED') {
        if (this.terminal())
            return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        if (notify && this.#connectionId) {
            try {
                this.#sender.tryError(encodeMessage({ ...this.header(T.ERROR), errorCode: error instanceof ProtocolError ? error.code : ErrorCode.PROTOCOL, errorMessage: error.message.slice(0, 120) }));
            }
            catch { /* Close remains authoritative. */ }
        }
        this.#failure = error;
        this.#state = state;
        clearTimeout(this.#handshakeTimer);
        if (this.#pending) {
            clearTimeout(this.#pending.timer);
            this.#pending.reject(error);
            this.#pending = undefined;
        }
        this.#rejectReady(error);
        this.#sender.close(error);
        this.#incoming.length = 0;
        this.#incomingBytes = 0;
        try {
            this.engine.reset();
        }
        finally {
            this.#unsubscribe();
            this.transport.close(error.message);
        }
    }
}
