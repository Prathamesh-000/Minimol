import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=pathToFileURL(resolve(process.env.MINIMOL_DEMO_DIR??'demo-dist')+'/');
const report={physicalPhonesTested:false,scope:'Desktop Chrome with synthetic visibility/timer transitions and actual Worker termination/WebRTC. NOT screen-lock or mobile evidence.',tests:[]};
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path==='/network-info'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"clientIPv4":null}');return}
 if(!/^\/(?:index.html|sw.js|offline-assets.json|assets\/[a-f0-9]{16}\/[\w/.-]+|model\/(?:phone[12].bin|manifest.json)|wasm\/[\w.-]+)$/.test(path)){res.writeHead(404);res.end();return}
 try{const data=await readFile(new URL('.'+path,root));res.writeHead(200,{'Cache-Control':'no-store','Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.json')?'application/json':path.endsWith('.wasm')?'application/wasm':'application/octet-stream'});res.end(data)}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:process.env.MINIMOL_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});report.browser=browser.version();
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]),pages=await Promise.all(contexts.map(c=>c.newPage()));
 for(const p of pages)await p.goto(`http://127.0.0.1:${server.address().port}/index.html`);
 async function fresh(){await Promise.all(pages.map((p,i)=>p.evaluate(role=>window.createSession(role),`phone${i+1}`)))}
 async function connect(offer){offer??=await pages[0].evaluate(()=>session.pairing.offer());const answer=await pages[1].evaluate(o=>session.pairing.answer(o),offer);await pages[0].evaluate(a=>session.pairing.applyAnswer(a),answer);await Promise.all(pages.map(p=>p.evaluate(()=>session.ready())))}
 async function golden(){assert.deepEqual(await pages[0].evaluate(async()=>[...(await session.generate('Hello',8)).generated]),[63,119,179,184,253,37,243,172]);for(const p of pages)assert.equal((await p.evaluate(()=>session.call('stats'))).engine.position,12)}
 await fresh();const offer=await pages[0].evaluate(()=>session.pairing.offer());
 await pages[0].evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
 assert.equal(await pages[0].evaluate(()=>session.pairing.status.hasOffer),true);
 await pages[0].evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await connect(offer);await golden();
 report.tests.push('pending manual offer survives synthetic background/foreground; canonical pair works without SharedArrayBuffer/COOP');assert.equal(await pages[0].evaluate(()=>crossOriginIsolated),false);
 await pages[0].evaluate(()=>{window.interrupted=session.generate('Hello',500).then(()=>'unexpected success',e=>e.message)});
 await pages[1].waitForFunction(async()=>(await session.call('stats')).engine.position>15);
 await assert.rejects(pages[0].evaluate(()=>session.generate('Hello',8)),/already running/);
 await pages[0].evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
 assert.notEqual(await pages[0].evaluate(()=>window.interrupted),'unexpected success');
 const cleanup=await pages[0].evaluate(()=>session.resourceState);assert.equal(cleanup.closed,true);assert.equal(cleanup.pendingCommands,0);assert.equal(cleanup.lifecycleBound,false);assert.equal(cleanup.heartbeatActive,false);assert.equal(cleanup.workerTerminationRequested,true);
 await pages[1].waitForFunction(()=>session.pairing.status.closed);await pages[0].evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
 report.tests.push('active background cancels actual incremental inference, blocks duplicate generation and cleans Worker/timers/listeners/pending RPCs');
 await fresh();await connect();await golden();report.tests.push('fresh pairing after lifecycle cancellation restores canonical generation');
 await pages[0].evaluate(()=>session.lifecycle.reset(Date.now()-30000,performance.now()-30000));
 await assert.rejects(pages[0].evaluate(()=>session.generate('Hello',8)));
 assert.match(await pages[0].evaluate(()=>session.pairing.status.reason),/paused/);report.tests.push('synthetic execution gap rejects stale work before emitting new bytes');
 await fresh();await connect();await pages[0].evaluate(()=>session.worker.terminate());
 await assert.rejects(pages[0].evaluate(()=>session.call('stats')));
 assert.equal(await pages[0].evaluate(()=>session.resourceState.closed),true);report.tests.push('actual silent Worker termination detected by deadline; session invalidated');
 await fresh();await connect();await golden();report.tests.push('new Worker and verified cached shard recover after termination');
 await pages[0].evaluate(()=>document.dispatchEvent(new Event('freeze')));assert.equal(await pages[0].evaluate(()=>session.resourceState.closed),true);
 report.tests.push('synthetic freeze invalidates active session instead of pretending background execution');
 for(let i=0;i<3;i++){await fresh();for(const p of pages){assert.equal((await p.evaluate(()=>session.call('stats'))).position,0);await p.evaluate(()=>session.close());const s=await p.evaluate(()=>session.resourceState);assert.equal(s.pendingCommands,0);assert.equal(s.lifecycleBound,false)}}
 report.tests.push('three repeated role load/unload cycles reuse verified cache and release session resources (GC/RSS not asserted)');
 await fresh();await connect();await pages[0].evaluate(()=>session.pairing.dataChannel.send(new ArrayBuffer(39)));await pages[1].waitForFunction(()=>session.pairing.status.closed);
 assert.match(await pages[1].locator('#last-error').textContent(),/Malformed/);report.tests.push('invalid actual binary DataChannel frame fails closed with visible error');
 await fresh();await connect();await golden();await pages[0].waitForFunction(()=>document.getElementById('mobile-load').textContent.includes('ms'));
 assert.ok((await pages[0].evaluate(()=>session.modelInfo.wasmMemoryBytes))>0);report.tests.push('final reconnection, golden KV progression and measured load/WASM memory diagnostics');
 report.finalResources=await Promise.all(pages.map(async p=>{await p.evaluate(()=>session.close());return p.evaluate(()=>session.resourceState)}));
 await writeFile(new URL('../artifacts/reports/milestone8-mobile-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(`PASS: ${report.tests.length} desktop mobile-reliability scenarios; physical phones NOT TESTED`);
}finally{await browser?.close();await new Promise(r=>server.close(r))}
