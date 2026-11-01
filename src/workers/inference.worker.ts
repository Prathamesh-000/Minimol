import { assertRole } from '../inference/modelConfig.js';
import { loadRoleShard } from '../inference/weightLoader.js';
import { selectBackend, type BackendPreference } from '../inference/wasmBackend.js';
import { createWorkerRuntime } from './workerRuntime.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const role = new URL(scope.location.href).searchParams.get('role');
assertRole(role);
const handle = createWorkerRuntime(role, async request => {
  if (typeof request.modelBaseUrl !== 'string' || typeof request.wasmBaseUrl !== 'string') throw new Error('Local model and WASM asset URLs are required');
  // Local app origin only. Role weights and optional kernels never come from a service.
  const modelBase = new URL(request.modelBaseUrl, scope.location.href);
  const wasmBase = new URL(request.wasmBaseUrl, scope.location.href);
  if (modelBase.origin !== scope.location.origin || wasmBase.origin !== scope.location.origin) throw new Error('Assets must use the application origin');
  const shard = await loadRoleShard(role, modelBase);
  const selected = await selectBackend(role, (request.backend ?? 'typescript') as BackendPreference, wasmBase);
  return { shard, ...selected };
});
let pending = 0, queue = Promise.resolve();
scope.onmessage = event => {
  if (pending >= 8) {
    scope.postMessage({ id: event.data?.id ?? -1, ok: false, error: 'Worker queue limit exceeded' });
    return;
  }
  pending++;
  queue = queue.then(async () => {
    try { const { reply, transfer } = await handle(event.data); scope.postMessage(reply, transfer); }
    finally { pending--; }
  });
};
