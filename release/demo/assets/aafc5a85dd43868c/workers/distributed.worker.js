import { assertRole } from '../inference/modelConfig.js';
import { loadCachedShard } from '../offline/shardCache.js';
import { Phone1Engine } from '../inference/phone1Engine.js';
import { Phone2Engine } from '../inference/phone2Engine.js';
import { DistributedRuntime } from '../distributed/runtime.js';
import { DistributedCoordinator } from '../distributed/coordinator.js';
import { selectBackend } from '../inference/wasmBackend.js';
import { MAX_FRAME_BYTES } from '../networking/protocol.js';
const scope = self;
const role = new URL(scope.location.href).searchParams.get('role');
assertRole(role);
let engine, manifest, runtime;
let coordinator;
let events, attempted = false;
let nextWire = 0;
const writes = new Map();
const transport = {
    readyState: 'open', bufferedAmount: 0,
    subscribe(value) { events = value; return () => { events = undefined; }; },
    send(frame) {
        if (transport.readyState !== 'open' || frame.byteLength > MAX_FRAME_BYTES)
            throw new Error('Worker transport closed/oversized');
        const wireId = nextWire++;
        writes.set(wireId, frame.byteLength);
        transport.bufferedAmount += frame.byteLength;
        scope.postMessage({ kind: 'wire', wireId, frame }, [frame]);
    },
    close(reason) {
        if (transport.readyState === 'closed')
            return;
        transport.readyState = 'closed';
        transport.bufferedAmount = 0;
        writes.clear();
        events?.close(reason);
        scope.postMessage({ kind: 'closed', reason });
    },
};
scope.onmessage = async ({ data }) => {
    if (data.kind === 'wire') {
        events?.message(data.frame);
        return;
    }
    if (data.kind === 'ack') {
        transport.bufferedAmount -= writes.get(data.wireId) ?? 0;
        writes.delete(data.wireId);
        events?.writable();
        return;
    }
    if (data.kind === 'closed') {
        transport.close(data.reason);
        return;
    }
    const { id, command } = data;
    try {
        let result;
        if (command === 'load') {
            if (attempted)
                throw new Error('Worker already loaded');
            attempted = true;
            const loadStarted = performance.now();
            const model = new URL(data.modelBase, scope.location.href), wasm = new URL(data.wasmBase, scope.location.href);
            if (model.origin !== scope.location.origin || wasm.origin !== scope.location.origin)
                throw new Error('Same-origin assets required');
            const loaded = await loadCachedShard(role, model, message => scope.postMessage({ kind: 'loading', message }));
            const { shard } = loaded;
            manifest = loaded.manifest;
            const selected = await selectBackend(role, 'auto', wasm);
            engine = role === 'phone1' ? new Phone1Engine(shard, selected.backend) : new Phone2Engine(shard, selected.backend);
            result = { ...engine.stats, loadMs: performance.now() - loadStarted, shardBytes: engine.parameterCount * 4, hash: engine.shardHash, cached: loaded.cached, cacheWarning: loaded.cacheWarning, fallbackReasons: selected.fallbackReasons };
        }
        else if (command === 'attach') {
            if (!engine || runtime)
                throw new Error('Load role first; attach once');
            runtime = new DistributedRuntime(engine, transport, manifest, { allowDebug: data.debug === true, timeoutMs: 15000 });
            if (role === 'phone1')
                coordinator = new DistributedCoordinator(runtime);
            await runtime.start();
            result = runtime.stats;
        }
        else if (command === 'generate') {
            if (!runtime)
                throw new Error('Peer not ready');
            const observed = [];
            const started = performance.now();
            let firstByteMs = null;
            let previous = started;
            const timings = [];
            if (!coordinator)
                throw new Error('Only Phone 1 generates');
            result = await coordinator.generate(data.prompt, data.count, { debug: data.debug === true,
                onByte(byte) { firstByteMs ??= performance.now() - started; scope.postMessage({ kind: 'byte', byte }); },
                onStep(step) { const now = performance.now(); timings.push({ position: step.position, elapsedMs: now - previous, phone1ComputeMs: step.phone1ComputeMs, phone2ComputeMs: step.phone2ComputeMs, roundTripMs: step.roundTripMs, exchangeOverheadMs: Math.max(0, step.roundTripMs - step.phone2ComputeMs) }); previous = now; if (data.debug)
                    observed.push(step); } });
            const totalMs = performance.now() - started;
            result = { ...result, observed, benchmark: { scope: 'real DataChannel generation on this pair; device classification requires operator evidence', totalMs, prefillToFirstByteMs: firstByteMs, timings, kv: engine.stats, generatedBytesPerSecond: result.generated.length * 1000 / totalMs, note: 'roundTripMs includes remote compute; exchangeOverheadMs includes queues/serialization/scheduling and is NOT one-way network latency' } };
        }
        else if (command === 'ping')
            result = runtime && !runtime.busy ? await runtime.ping() : null;
        else if (command === 'stats')
            result = runtime?.stats ?? engine?.stats;
        else
            throw new Error('Unknown worker command');
        scope.postMessage({ kind: 'reply', id, ok: true, result });
    }
    catch (error) {
        scope.postMessage({ kind: 'reply', id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
};
