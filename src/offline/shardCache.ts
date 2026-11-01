import { type Role, assertRole } from '../inference/modelConfig.js';
import { validateManifest } from '../inference/modelManifest.js';
import { consumeShard } from '../inference/weightLoader.js';

/** Cache only complete, verified role bytes. A failed cache write never blocks online inference. */
export async function loadCachedShard(role: Role, base: URL, progress: (message: string) => void) {
  assertRole(role);
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error('Manifest unavailable; connect to the HTTPS host and retry');
  const manifest = validateManifest(await response.json());
  const url = new URL(`${role}.bin`, base).href;
  const name = `minimol-shard-${role}-${manifest.files[role].sha256}`;
  let cache: Cache | undefined, cacheWarning = '';
  try {
    // One role per browser profile. Switching roles clears the previous disk shard.
    for (const old of await caches.keys()) if (old.startsWith('minimol-shard-') && old !== name) await caches.delete(old);
    cache = await caches.open(name);
    const cached = await cache.match(url);
    if (cached) {
      progress('Verifying cached shard SHA-256…');
      try { return { shard: await consumeShard(role, manifest, await cached.arrayBuffer()), manifest, cached: true, cacheWarning }; }
      catch { await cache.delete(url); progress('Cached shard damaged; downloading a fresh copy…'); }
    }
  } catch { cacheWarning = 'Storage unavailable; this session is online-only'; }
  progress('Downloading assigned shard…');
  const weights = await fetch(url, { cache: 'no-store', redirect: 'error' });
  if (!weights.ok) throw new Error(`Shard download failed (${weights.status}); retry loading`);
  const bytes = await weights.arrayBuffer();
  progress('Download complete; verifying SHA-256…');
  let snapshot: Response | undefined;
  if (cache) try { snapshot = new Response(bytes); } catch { cacheWarning = 'Cache snapshot unavailable; online-only until retry succeeds'; }
  const shard = await consumeShard(role, manifest, bytes);
  let cached = false;
  if (cache && snapshot) try { await cache.put(url, snapshot); cached = true; }
  catch { cacheWarning = 'Shard verified, but storage quota/policy prevented caching. Online-only until retry succeeds.'; }
  return { shard, manifest, cached, cacheWarning };
}
