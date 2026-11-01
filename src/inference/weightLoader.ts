import { assertRole, ROLE_COUNTS, type Role } from './modelConfig.js';
import { validateManifest, type ModelManifest } from './modelManifest.js';

const verified = new WeakSet<object>();
export interface VerifiedShard {
  readonly role: Role; readonly hash: string; readonly parameterCount: number;
  readonly tensorNames: readonly string[];
  tensor(name: string): Float32Array;
}

export function requireVerifiedShard(shard: VerifiedShard, role: Role): void {
  if (!verified.has(shard) || shard.role !== role) throw new Error(`A verified ${role} shard is required`);
}

function checkBuffer(role: Role, buffer: ArrayBuffer): void {
  assertRole(role);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== ROLE_COUNTS[role] * 4) throw new Error(`Wrong ${role} shard size`);
}
/** Defensive API for callers that retain aliases: preserve its original snapshot semantics. */
export async function decodeShard(role: Role, manifestValue: unknown, buffer: ArrayBuffer): Promise<VerifiedShard> {
  checkBuffer(role, buffer);
  return verifyOwned(role, manifestValue, buffer.slice(0));
}
/** Only for exclusive buffers from fetch/cache: transfer ownership before hashing. */
export async function consumeShard(role: Role, manifestValue: unknown, buffer: ArrayBuffer): Promise<VerifiedShard> {
  checkBuffer(role, buffer);
  let owned: ArrayBuffer;
  try { owned = structuredClone(buffer, { transfer: [buffer] }); }
  catch { owned = buffer.slice(0); } // Older browsers keep the safe copy fallback.
  return verifyOwned(role, manifestValue, owned);
}
async function verifyOwned(role: Role, manifestValue: unknown, owned: ArrayBuffer): Promise<VerifiedShard> {
  const manifest = validateManifest(manifestValue);
  const digest = await crypto.subtle.digest('SHA-256', owned);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.files[role].sha256) throw new Error(`${role} SHA-256 mismatch`);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let values: Float32Array;
  if (littleEndian) values = new Float32Array(owned);
  else {
    values = new Float32Array(owned.byteLength / 4);
    const view = new DataView(owned);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
  }
  for (const value of values) if (!Number.isFinite(value)) throw new Error('Nonfinite FP32 weight');
  const tensors = new Map<string, Float32Array>();
  for (const t of manifest.tensors) if (t.owner === role) tensors.set(t.name, values.subarray(t.offset_bytes / 4, t.offset_bytes / 4 + t.numel));
  const shard: VerifiedShard = Object.freeze({
    role, hash, parameterCount: ROLE_COUNTS[role], tensorNames: Object.freeze([...tensors.keys()]),
    tensor(name: string) {
      const tensor = tensors.get(name);
      if (!tensor) throw new Error(`${role} does not own tensor ${name}`);
      return tensor;
    },
  });
  verified.add(shard);
  return shard;
}

/** Fetch only the selected role; never inspect/download full weights or peer bytes. */
export async function loadRoleShard(role: Role, baseUrl: string | URL, fetcher: typeof fetch = fetch): Promise<VerifiedShard> {
  assertRole(role);
  const base = new URL(baseUrl, globalThis.location?.href);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const response = await fetcher(new URL('manifest.json', base), { redirect: 'error' });
  if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status}`);
  const manifest: ModelManifest = validateManifest(await response.json());
  const weights = await fetcher(new URL(`${role}.bin`, base), { redirect: 'error' });
  if (!weights.ok) throw new Error(`${role} weight fetch failed: ${weights.status}`);
  return decodeShard(role, manifest, await weights.arrayBuffer());
}
