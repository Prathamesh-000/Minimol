import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeShard, loadRoleShard } from '../../dist/inference/weightLoader.js';
import { validateManifest } from '../../dist/inference/modelManifest.js';
import { roleBytes, manifest } from './helpers.mjs';

test('browser loader requests only manifest and selected role shard', async () => {
  for (const role of ['phone1', 'phone2']) {
    const requests = [];
    const fetcher = async (url, options) => {
      const pathname = new URL(url).pathname; requests.push(pathname);
      assert.equal(options.redirect, 'error');
      if (pathname.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
      assert.equal(pathname, `/model/${role}.bin`);
      return new Response(await roleBytes(role));
    };
    const shard = await loadRoleShard(role, 'https://local.test/model/', fetcher);
    assert.equal(shard.hash, manifest.files[role].sha256);
    assert.deepEqual(requests, ['/model/manifest.json', `/model/${role}.bin`]);
  }
});

test('loader rejects wrong hash, truncated bytes, full-model ownership and nonfinite weights', async () => {
  const original = await roleBytes('phone1');
  const bad = original.slice(0); new Uint8Array(bad)[0] ^= 1;
  await assert.rejects(decodeShard('phone1', manifest, bad), /SHA-256/);
  await assert.rejects(decodeShard('phone1', manifest, original.slice(4)), /size/);
  const changed = structuredClone(manifest); changed.files.full = { name: 'weights.bin' };
  assert.throws(() => validateManifest(changed), /two role shards/);
  new DataView(bad).setFloat32(0, Infinity, true);
  const nanManifest = structuredClone(manifest);
  nanManifest.files.phone1.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bad)).toString('hex');
  await assert.rejects(decodeShard('phone1', nanManifest, bad), /Nonfinite/);
});

test('loader rejects malformed tensor ownership, offsets, layouts and unsafe file paths', () => {
  for (const edit of [
    m => m.tensors[0].owner = 'phone2', m => m.tensors[0].offset_bytes = 4,
    m => m.tensors[0].shape.reverse(), m => m.config_sha256 = '0'.repeat(64),
    m => m.model_config.vocab_size = 257, m => m.files.phone1.name = '../phone2.bin',
  ]) {
    const bad = structuredClone(manifest); edit(bad);
    assert.throws(() => validateManifest(bad));
  }
});

test('fetch failures never fall back to a different role or unverified weights', async () => {
  let calls = 0;
  await assert.rejects(loadRoleShard('phone1', 'https://local.test/model/', async () => { calls++; return new Response('', { status: 404 }); }), /Manifest fetch failed/);
  assert.equal(calls, 1);
});

test('exclusive fetched buffers transfer ownership without changing verified weights across load/dispose cycles',async()=>{
 const {consumeShard}=await import('../../dist/inference/weightLoader.js');const {Phone1Engine}=await import('../../dist/inference/phone1Engine.js');
 for(let i=0;i<3;i++){const bytes=await roleBytes('phone1');const shard=await consumeShard('phone1',manifest,bytes);assert.equal(bytes.byteLength,0);assert.equal(shard.hash,manifest.files.phone1.sha256);const engine=new Phone1Engine(shard);assert.equal(engine.step(72,0).length,384);engine.dispose();assert.equal(engine.stats.disposed,true);assert.equal(engine.stats.position,0);assert.throws(()=>engine.step(72,0),/disposed/)}
});
test('exclusive loader safely falls back to a snapshot when transfer API is unavailable',async()=>{
 const {consumeShard}=await import('../../dist/inference/weightLoader.js');const bytes=await roleBytes('phone2');const original=globalThis.structuredClone;
 try{globalThis.structuredClone=undefined;const shard=await consumeShard('phone2',manifest,bytes);assert.equal(shard.hash,manifest.files.phone2.sha256);assert.equal(bytes.byteLength,21689856)}finally{globalThis.structuredClone=original}
});
test('manifest snapshots retain canonical offsets without invoking untrusted serialization methods',()=>{
 const candidate=structuredClone(manifest);let called=false;candidate.toJSON=()=>{called=true;throw new Error('untrusted hook')};
 const snapshot=validateManifest(candidate);candidate.tensors[0].offset_bytes=4;
 assert.equal(called,false);assert.equal(snapshot.tensors[0].offset_bytes,0);assert.equal(snapshot.model_config.hidden_dim,384);
});
