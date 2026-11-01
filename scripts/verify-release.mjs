import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pinned = {phone1:{bytes:22473216,sha256:'582f266866d34f17f081161ff196043ea9ceb0b1d09e0daf034ad0e0f2de22e6'},phone2:{bytes:21689856,sha256:'50a4e8ccc29188b78542957d3705669929dc2e4caf2e334a52622f074c2667f2'}};
const fullHash='0b47c07669cbe9d6ac70d52ea0385e035feb4c3d3879896a4aab9788ae4a692c';
const controls=['RELEASE_MANIFEST.json','RELEASE_CHECKSUMS.txt'];
const requiredDocs=['README.md','TECHNICAL_OVERVIEW.md','DEMO_SCRIPT.md','JUDGE_QA.md','LIMITATIONS.md','VALIDATION_STATUS.md','AUDIT.md'];
function require(value,message){if(!value)throw new Error(message)}
export async function inventory(root,prefix='') {
 const records=[];
 for(const entry of (await readdir(join(root,prefix))).sort()) {
  const name=prefix+entry,info=await lstat(join(root,name));require(!info.isSymbolicLink(),`Symlink forbidden: ${name}`);
  require(!/(?:^|\/)(?:weights\.bin|node_modules|\.venv|\.tools|\.git)(?:\/|$)|\.(?:pem|key)$/.test(name),`Private/development artifact: ${name}`);
  if(info.isDirectory())records.push(...await inventory(root,name+'/'));
  else{require(info.isFile(),`Unexpected artifact: ${name}`);if(!controls.includes(name)){const data=await readFile(join(root,name));records.push({path:name,bytes:data.length,sha256:hash(data)})}}
 }
 return records;
}
export async function inspectRelease(root) {
 const files=await inventory(root),names=new Set(files.map(f=>f.path));
 for(const doc of requiredDocs)require(names.has(doc),`Missing documentation: ${doc}`);
 const shell=JSON.parse(await readFile(join(root,'demo/offline-assets.json'),'utf8'));
 require(/^[a-f0-9]{16}$/.test(shell.version),'Invalid build ID');
 const base=`demo/assets/${shell.version}/`;
 const model=JSON.parse(await readFile(join(root,'demo/model/manifest.json'),'utf8'));
 const canonical=JSON.parse(await readFile(new URL('../public/model/manifest.json',import.meta.url),'utf8'));
 for(const field of ['format_version','dtype','byte_order','layout','config_sha256','parameter_count','model_config','tensors','files','generation'])require(JSON.stringify(model[field])===JSON.stringify(canonical[field]),`Model schema mismatch: ${field}`);
 require(model.parameter_count===11040768&&model.dtype==='float32','Model count/FP32 mismatch');
 const full=createHash('sha256');
 for(const role of ['phone1','phone2']){const b=await readFile(join(root,`demo/model/${role}.bin`));require(b.length===pinned[role].bytes&&hash(b)===pinned[role].sha256,`Shard integrity mismatch: ${role}`);require(model.files[role].sha256===pinned[role].sha256,'Unpinned manifest hash');full.update(b);for(let offset=0;offset<b.length;offset+=4)require(Number.isFinite(b.readFloatLE(offset)),'Nonfinite FP32 release weight');}
 require(full.digest('hex')===fullHash,'Shards do not reconstruct canonical FP32 bytes');
 const wasmHashes={scalar:'883d49f56df9f0942c66522efa082320cc881acb22c7906df5f046d9682b0ae2',simd:'d18d65ee02f330d1b1e0c03a0e87d797e5d732232f297fa1983f78ce473683e8'};
 for(const variant of ['scalar','simd']){const b=await readFile(join(root,`demo/wasm/matrix-${variant}.wasm`));require(hash(b)===wasmHashes[variant],'Unapproved WASM checksum');const module=new WebAssembly.Module(b);require(WebAssembly.Module.imports(module).length===0,'Unexpected WASM imports');const instance=new WebAssembly.Instance(module);require(instance.exports.kernel_version()===1,'Invalid WASM kernel version');require(instance.exports.kernel_simd()===(variant==='simd'?1:0),'WASM scalar/SIMD mismatch');require(typeof instance.exports.matvec==='function'&&instance.exports.memory instanceof WebAssembly.Memory,'Missing WASM exports');}
 require(Array.isArray(shell.assets)&&new Set(shell.assets).size===shell.assets.length,'Invalid/duplicate shell assets');
 for(const asset of shell.assets){require(typeof asset==='string'&&/^\.\/[\w./-]+$/.test(asset)&&!asset.includes('..')&&!asset.endsWith('.bin'),'Unsafe shell entry or precached model');require(names.has('demo/'+asset.slice(2)),`Missing shell asset: ${asset}`)}
 for(const f of ['demo/index.html','demo/sw.js',base+'workers/distributed.worker.js',base+'demo/session.js',base+'vendor/qrcode.js',base+'vendor/jsQR.js',base+'vendor/jsQR-LICENSE.txt',base+'vendor/qrcode-LICENSE.txt'])require(names.has(f),`Missing runtime: ${f}`);
 const html=await readFile(join(root,'demo/index.html'),'utf8'),sw=await readFile(join(root,'demo/sw.js'),'utf8');require(html.includes(shell.version)&&!html.includes('__MINIMOL_BUILD__'),'HTML build substitution missing');require(sw.includes(shell.version)&&!sw.includes('__ASSETS__'),'SW build substitution missing');
 for(const name of names)if(name.startsWith('demo/assets/'))require(name.startsWith(base),`Stale asset version in release: ${name}`);
 // Check every static relative ES import and HTML script source exists.
 for(const file of files.filter(f=>f.path.endsWith('.js')&&f.path.startsWith('demo/'))){const source=await readFile(join(root,file.path),'utf8');for(const m of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const target=new URL(m[1],pathToFileURL(join(root,file.path)));require(target.protocol==='file:'&&fileURLToPath(target).startsWith(root+sep),'Import escapes release');await lstat(target);}}
 for(const m of html.matchAll(/(?:src=|from\s*)['"](\.\/[^'"]+)['"]/g))require(names.has('demo/'+m[1].slice(2)),`Missing HTML module ${m[1]}`);
 return {files,buildId:shell.version,model:{parameterCount:11040768,dtype:'float32',seed:42,fullSha256:fullHash,shards:pinned},offlineShellAssets:shell.assets.length};
}
export async function verifyRelease(root) {
 const info=await inspectRelease(root),manifest=JSON.parse(await readFile(join(root,'RELEASE_MANIFEST.json'),'utf8'));
 require(manifest.formatVersion===1&&manifest.buildId===info.buildId,'Release version/build mismatch');
 require(JSON.stringify(manifest.files)===JSON.stringify(info.files),'Release inventory/checksum mismatch');
 require(JSON.stringify(manifest.model)===JSON.stringify(info.model),'Release model metadata mismatch');
 require(Object.values(manifest.physicalDeviceTests).every(s=>s==='NOT TESTED')&&JSON.stringify(Object.keys(manifest.physicalDeviceTests).sort())===JSON.stringify(['iPhoneSafariCamera','androidChromeCamera','offlineReloadBothPhones','screenLockRecovery','interruptedDownloadRecovery','mobilePerformance'].sort()),'Physical test status must stay NOT TESTED');
 const checksum=await readFile(join(root,'RELEASE_CHECKSUMS.txt'),'utf8');
 const expected=info.files.map(f=>`${f.sha256}  ${f.path}\n`).join('')+`${hash(await readFile(join(root,'RELEASE_MANIFEST.json')))}  RELEASE_MANIFEST.json\n`;
 require(checksum===expected,'Checksum list mismatch');return info;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 const {values}=parseArgs({options:{root:{type:'string',default:'release'},write:{type:'boolean',default:false}}});const root=resolve(values.root);
 if(values.write){const info=await inspectRelease(root);const manifest={formatVersion:1,toolchain:{node:process.version,npmLockSha256:hash(await readFile(new URL('../package-lock.json',import.meta.url)))},...info,physicalDeviceTests:{iPhoneSafariCamera:'NOT TESTED',androidChromeCamera:'NOT TESTED',offlineReloadBothPhones:'NOT TESTED',screenLockRecovery:'NOT TESTED',interruptedDownloadRecovery:'NOT TESTED',mobilePerformance:'NOT TESTED'},integrityNote:'SHA-256 inventory, not a digital signature; verifier code and delivery origin must be trusted'};await writeFile(join(root,'RELEASE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(join(root,'RELEASE_CHECKSUMS.txt'),info.files.map(f=>`${f.sha256}  ${f.path}\n`).join('')+`${hash(await readFile(join(root,'RELEASE_MANIFEST.json')))}  RELEASE_MANIFEST.json\n`);}
 const result=await verifyRelease(root);console.log(JSON.stringify({status:'PASS',build:result.buildId,files:result.files.length,shellAssets:result.offlineShellAssets,parameterCount:11040768,physicalDeviceTests:'NOT TESTED'},null,2));
}
