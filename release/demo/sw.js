/* Build substitutes an immutable asset list. No model binaries are precached. */
const VERSION = 'aafc5a85dd43868c';
const ASSETS = ["./index.html","./model/manifest.json","./wasm/matrix-scalar.wasm","./wasm/matrix-simd.wasm","./assets/aafc5a85dd43868c/demo/capabilities.js","./assets/aafc5a85dd43868c/demo/dashboard.js","./assets/aafc5a85dd43868c/demo/lifecycle.js","./assets/aafc5a85dd43868c/demo/readiness.js","./assets/aafc5a85dd43868c/demo/session.js","./assets/aafc5a85dd43868c/demo/validation.js","./assets/aafc5a85dd43868c/distributed/coordinator.js","./assets/aafc5a85dd43868c/distributed/runtime.js","./assets/aafc5a85dd43868c/inference/attention.js","./assets/aafc5a85dd43868c/inference/embeddings.js","./assets/aafc5a85dd43868c/inference/feedForward.js","./assets/aafc5a85dd43868c/inference/gelu.js","./assets/aafc5a85dd43868c/inference/generation.js","./assets/aafc5a85dd43868c/inference/kvCache.js","./assets/aafc5a85dd43868c/inference/layerNorm.js","./assets/aafc5a85dd43868c/inference/matrixMultiply.js","./assets/aafc5a85dd43868c/inference/modelConfig.js","./assets/aafc5a85dd43868c/inference/modelManifest.js","./assets/aafc5a85dd43868c/inference/phone1Engine.js","./assets/aafc5a85dd43868c/inference/phone2Engine.js","./assets/aafc5a85dd43868c/inference/roleEngine.js","./assets/aafc5a85dd43868c/inference/tensor.js","./assets/aafc5a85dd43868c/inference/transformerBlock.js","./assets/aafc5a85dd43868c/inference/wasmBackend.js","./assets/aafc5a85dd43868c/inference/weightLoader.js","./assets/aafc5a85dd43868c/networking/lanCandidates.js","./assets/aafc5a85dd43868c/networking/pairing.js","./assets/aafc5a85dd43868c/networking/protocol.js","./assets/aafc5a85dd43868c/networking/qrPayload.js","./assets/aafc5a85dd43868c/networking/transport.js","./assets/aafc5a85dd43868c/networking/webrtcTransport.js","./assets/aafc5a85dd43868c/offline/shardCache.js","./assets/aafc5a85dd43868c/vendor/jsQR.js","./assets/aafc5a85dd43868c/vendor/qrcode.js","./assets/aafc5a85dd43868c/workers/distributed.worker.js","./assets/aafc5a85dd43868c/workers/inference.worker.js","./assets/aafc5a85dd43868c/workers/workerRuntime.js"];
const CACHE = 'minimol-shell-' + VERSION;
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try { await cache.addAll(ASSETS); } catch (error) { await caches.delete(CACHE); throw error; }
  // No skipWaiting: an update must not replace an active two-phone session.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Activation waits for old tabs to close; only then remove obsolete shells.
  for (const name of await caches.keys()) if (name.startsWith('minimol-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  const root = new URL('./', self.registration.scope);
  const relative = url.pathname.slice(root.pathname.length);
  // Shards are independently verified/cached by the role Worker, never here.
  if (relative === 'network-info' || relative.endsWith('.bin')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === 'navigate' ? new URL('index.html', root).href : url.origin + url.pathname;
    const cached = await cache.match(key);
    // A cached Response carries its original URL. A Worker must retain the
    // requested ?role=... URL; an empty Response URL preserves that request URL.
    return cached ? new Response(cached.body, { status: cached.status, headers: cached.headers }) : fetch(event.request);
  })());
});
