import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {verifyRelease} from '../../scripts/verify-release.mjs';
const source=resolve('release');
async function changed(action){const root=await mkdtemp(join(tmpdir(),'minimol-integrity-test-'));try{await cp(source,root,{recursive:true});await action(root);await assert.rejects(verifyRelease(root));}finally{await rm(root,{recursive:true,force:true})}}
test('packaged release independently verifies canonical shards, all assets and inventory',async()=>{const r=await verifyRelease(source);assert.equal(r.model.parameterCount,11040768);assert.equal(r.model.dtype,'float32')});
test('changed shard bytes are rejected',async()=>changed(async root=>{const path=join(root,'demo/model/phone1.bin'),b=await readFile(path);b[0]^=1;await writeFile(path,b)}));
test('missing Worker and unlisted artifacts are rejected',async()=>{await changed(async root=>{const r=JSON.parse(await readFile(join(root,'RELEASE_MANIFEST.json')));await unlink(join(root,`demo/assets/${r.buildId}/workers/distributed.worker.js`))});await changed(root=>writeFile(join(root,'unexpected.txt'),'extra'))});
test('tampered checksums and fake physical PASS are rejected',async()=>{await changed(root=>writeFile(join(root,'RELEASE_CHECKSUMS.txt'),'fake'));await changed(async root=>{const p=join(root,'RELEASE_MANIFEST.json'),r=JSON.parse(await readFile(p));r.physicalDeviceTests.iPhoneSafariCamera='PASS';await writeFile(p,JSON.stringify(r))})});
test('verification never executes modified package JavaScript',async()=>{
 delete globalThis.__minimolUntrustedExecuted;
 await changed(async root=>{const m=JSON.parse(await readFile(join(root,'RELEASE_MANIFEST.json'))),p=join(root,`demo/assets/${m.buildId}/inference/modelManifest.js`);await writeFile(p,'globalThis.__minimolUntrustedExecuted = true;\n'+await readFile(p,'utf8'))});
 assert.equal(globalThis.__minimolUntrustedExecuted,undefined);
});
test('verified previous releases can be archived idempotently without overwriting changed backups',async()=>{
 const {archiveRelease}=await import('../../scripts/archive-release.mjs');const root=await mkdtemp(join(tmpdir(),'minimol-archive-test-'));
 try{const target=await archiveRelease(root,source);assert.equal(await archiveRelease(root,source),target);await verifyRelease(target);await writeFile(join(target,'user-note.txt'),'preserve');await assert.rejects(archiveRelease(root,source));await verifyRelease(source)}finally{await rm(root,{recursive:true,force:true})}
});
