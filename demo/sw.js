/* Build substitutes an immutable asset list. No model binaries are precached. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
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
