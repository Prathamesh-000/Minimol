/* Build substitutes an immutable asset list. No model binaries are precached. */
const VERSION = '9f5153c5b7effc98';
const ASSETS = ["./index.html","./model/manifest.json","./wasm/matrix-scalar.wasm","./wasm/matrix-simd.wasm","./assets/9f5153c5b7effc98/demo/dashboard.js","./assets/9f5153c5b7effc98/demo/readiness.js","./assets/9f5153c5b7effc98/demo/session.js","./assets/9f5153c5b7effc98/demo/validation.js","./assets/9f5153c5b7effc98/distributed/coordinator.js","./assets/9f5153c5b7effc98/distributed/runtime.js","./assets/9f5153c5b7effc98/inference/attention.js","./assets/9f5153c5b7effc98/inference/embeddings.js","./assets/9f5153c5b7effc98/inference/feedForward.js","./assets/9f5153c5b7effc98/inference/gelu.js","./assets/9f5153c5b7effc98/inference/generation.js","./assets/9f5153c5b7effc98/inference/kvCache.js","./assets/9f5153c5b7effc98/inference/layerNorm.js","./assets/9f5153c5b7effc98/inference/matrixMultiply.js","./assets/9f5153c5b7effc98/inference/modelConfig.js","./assets/9f5153c5b7effc98/inference/modelManifest.js","./assets/9f5153c5b7effc98/inference/phone1Engine.js","./assets/9f5153c5b7effc98/inference/phone2Engine.js","./assets/9f5153c5b7effc98/inference/roleEngine.js","./assets/9f5153c5b7effc98/inference/tensor.js","./assets/9f5153c5b7effc98/inference/transformerBlock.js","./assets/9f5153c5b7effc98/inference/wasmBackend.js","./assets/9f5153c5b7effc98/inference/weightLoader.js","./assets/9f5153c5b7effc98/networking/lanCandidates.js","./assets/9f5153c5b7effc98/networking/pairing.js","./assets/9f5153c5b7effc98/networking/protocol.js","./assets/9f5153c5b7effc98/networking/qrPayload.js","./assets/9f5153c5b7effc98/networking/transport.js","./assets/9f5153c5b7effc98/networking/webrtcTransport.js","./assets/9f5153c5b7effc98/offline/shardCache.js","./assets/9f5153c5b7effc98/vendor/jsQR.js","./assets/9f5153c5b7effc98/vendor/qrcode.js","./assets/9f5153c5b7effc98/workers/distributed.worker.js","./assets/9f5153c5b7effc98/workers/inference.worker.js","./assets/9f5153c5b7effc98/workers/workerRuntime.js"];
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
