import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const {values} = parseArgs({options:{out:{type:'string'},dist:{type:'string'}}});
const root = new URL('../', import.meta.url), target = values.out ? pathToFileURL(resolve(values.out)+'/') : new URL('demo-dist/', root);
await mkdir(target, { recursive: true });
const html = await readFile(new URL('demo/index.html', root), 'utf8');
const sw = await readFile(new URL('demo/sw.js', root), 'utf8');
const hash = createHash('sha256').update(html).update(sw);
const vendors = [['qrcode', 'node_modules/qrcode-generator/dist/qrcode.js'], ['jsQR', 'node_modules/jsqr/dist/jsQR.js']];
for (const [, path] of vendors) hash.update(await readFile(new URL(path, root)));
async function hashDirectory(directory) {
 for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  const child = new URL(entry.name+(entry.isDirectory()?'/':''),directory);
  if(entry.isDirectory())await hashDirectory(child);else if(entry.name.endsWith('.js'))hash.update(entry.name).update(await readFile(child));
 }
}
const compiled = values.dist ? pathToFileURL(resolve(values.dist)+'/') : new URL('dist/',root);
await hashDirectory(compiled);
const version = hash.digest('hex').slice(0,16);
await cp(compiled,new URL(`assets/${version}/`,target),{recursive:true});
await writeFile(new URL('index.html', target),html.replaceAll('./dist/',`./assets/${version}/`).replace('__MINIMOL_BUILD__',version));
for (const [source, destination] of [['dist','dist'],['public/model','model'],['public/wasm','wasm']]) await cp(source === 'dist' ? compiled : new URL(source, root), new URL(destination, target), { recursive: true });
console.log(`Static demo prepared in ${fileURLToPath(target)}. Serve this directory over trusted HTTPS on both phones.`);

const vendorDir = new URL(`assets/${version}/vendor/`,target); await mkdir(vendorDir,{recursive:true});
for (const [name,path] of vendors) await cp(new URL(path,root),new URL(name+'.js',vendorDir));
const assets = ['./index.html','./model/manifest.json','./wasm/matrix-scalar.wasm','./wasm/matrix-simd.wasm'];
async function listAssets(directory, prefix) { for (const entry of await readdir(directory,{withFileTypes:true})) { if(entry.isDirectory())await listAssets(new URL(entry.name+'/',directory),prefix+entry.name+'/');else if(entry.name.endsWith('.js'))assets.push(prefix+entry.name); } }
await listAssets(new URL(`assets/${version}/`,target),`./assets/${version}/`);
await writeFile(new URL('sw.js',target),sw.replace('__VERSION__',version).replace('__ASSETS__',JSON.stringify(assets)));
await writeFile(new URL('offline-assets.json',target),JSON.stringify({version,assets},null,2));
for (const [name,path] of [['jsQR','node_modules/jsqr/LICENSE']]) await cp(new URL(path,root),new URL(name+'-LICENSE.txt',vendorDir));

await writeFile(new URL('qrcode-LICENSE.txt',vendorDir),(await readFile(new URL('node_modules/qrcode-generator/dist/qrcode.js',root),'utf8')).split('var qrcode')[0]);
