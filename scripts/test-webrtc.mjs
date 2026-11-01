import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { networkInterfaces } from 'node:os';
import { validateLanIPv4 } from '../dist/networking/lanCandidates.js';
const root=new URL('../',import.meta.url),requests=[];
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/network-info'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({clientIPv4:null}));return}
 if (!/^\/(?:index\.html|(?:dist|assets\/[a-f0-9]{16})\/[a-zA-Z]+\/[a-zA-Z0-9.]+\.js|model\/(?:manifest\.json|phone[12]\.bin)|wasm\/matrix-(?:scalar|simd)\.wasm)$/.test(pathname)){res.writeHead(404);res.end();return}
 requests.push(pathname);
 try{const bytes=await readFile(new URL('demo-dist'+pathname,root));res.writeHead(200,{'Content-Type':pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.html')?'text/html':pathname.endsWith('.json')?'application/json':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'});res.end(bytes)}catch{res.writeHead(404);res.end()}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
let browser;const report={tests:[],cases:[]};
try{
 browser=await chromium.launch({executablePath:process.env.MINIMOL_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});report.browser=browser.version();
 const contexts=[await browser.newContext(),await browser.newContext()],roleRequests=[[],[]];
 contexts.forEach((context,i)=>context.on('request',request=>{const p=new URL(request.url()).pathname;if(p.endsWith('.bin'))roleRequests[i].push(p)}));
 const pages=await Promise.all(contexts.map(c=>c.newPage()));
 for(const page of pages)await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
 async function pair(){
  await Promise.all(pages.map((p,i)=>p.evaluate(role=>window.createSession(role,true),`phone${i+1}`)));
  await assert.rejects(pages[1].evaluate(()=>session.pairing.answer('malformed json')));
  const offer=await pages[0].evaluate(()=>session.pairing.offer());
  const answer=await pages[1].evaluate(text=>session.pairing.answer(text),offer);
  await pages[0].evaluate(text=>session.pairing.applyAnswer(text),answer);
  await Promise.all(pages.map(p=>p.evaluate(()=>session.ready())));
  for(const p of pages){assert.deepEqual(await p.evaluate(()=>session.pairing.pc.getConfiguration().iceServers),[]);assert.equal((await p.evaluate(()=>session.pairing.verifyPath())).directHost,true)}
 }
 await pair();report.tests.push('real offer/answer + ICE + reliable ordered DataChannel + protocol HELLO/READY + direct host path');
 await assert.rejects(pages[0].evaluate(()=>session.pairing.applyAnswer('{}')));report.tests.push('duplicate/malformed signaling rejected');
 const golden=JSON.parse(await readFile(new URL('tests/fixtures/golden_vectors.json',root)));
 for(const entry of golden.cases){
  const result=await pages[0].evaluate(async c=>{const r=await session.generate(Uint8Array.from(c.prompt_bytes),c.max_new_bytes,true);return {generated:[...r.generated],positions:r.processedPositions,observed:r.observed.map(s=>({position:s.position,activation:[...s.activation],logits:[...s.logits],byte:s.byte}))}},entry);
  assert.deepEqual(result.generated,entry.generated_bytes);let ae=0,le=0;
  for(const expected of entry.samples){const actual=result.observed.find(s=>s.position===expected.position);assert.equal(actual.byte,expected.greedy_byte);for(const [a,b,key] of [[actual.activation,expected.phone1_activation,'activation'],[actual.logits,expected.logits,'logits']])for(let i=0;i<a.length;i++){const e=Math.abs(a[i]-b[i]);assert.ok(e<=1e-4+1e-4*Math.abs(b[i]));if(key==='activation')ae=Math.max(ae,e);else le=Math.max(le,e)}}
  for(const p of pages){const stats=await p.evaluate(()=>session.call('stats'));assert.equal(stats.engine.position,result.positions);assert.equal(stats.trace.length,result.positions);assert.ok(stats.trace.every(s=>s.layerEvaluations===3))}
  report.cases.push({name:entry.name,positions:result.positions,activationError:ae,logitError:le});console.log(`WebRTC golden: ${entry.name} passed`);
 }
 report.tests.push('7 golden prompts; real activation/prediction transfer; both role counters');
 assert.equal(requests.filter(p=>p==='/model/phone1.bin').length,1);assert.equal(requests.filter(p=>p==='/model/phone2.bin').length,1);
 assert.deepEqual(roleRequests,[['/model/phone1.bin'],['/model/phone2.bin']]);
 await pages[0].evaluate(()=>session.pairing.pc.close());
 await pages[1].waitForFunction(()=>session.pairing.pc.connectionState==='closed');
 report.disconnectStatus=await pages[1].evaluate(()=>document.getElementById('status').textContent);
 report.tests.push('disconnection propagated');
 await pair();const again=await pages[0].evaluate(async()=>[...(await session.generate('Hello',8)).generated]);assert.deepEqual(again,golden.cases[0].generated_bytes);report.tests.push('fresh pairing and generation after disconnect');
 const oldGeneration=await pages[1].evaluate(async()=>(await session.call('stats')).generation);
 await pages[0].evaluate(()=>{window.inflight=session.generate('Hello',500).then(()=>'unexpected success',error=>error.message)});
 await pages[1].waitForFunction(async old=>(await session.call('stats')).generation>old && (await session.call('stats')).engine.position>0,oldGeneration);
 await pages[1].evaluate(()=>session.close('Test disconnect during generation'));
 assert.notEqual(await pages[0].evaluate(()=>window.inflight),'unexpected success');report.tests.push('disconnect during incremental generation rejects the pending operation');
 await pair();
 await pages[0].evaluate(()=>session.pairing.dataChannel.send('invalid text frame'));
 await pages[1].waitForFunction(()=>document.getElementById('status').textContent.includes('Malformed'));
 report.tests.push('malformed DataChannel message fails closed');
 await pages[0].evaluate(()=>session.close());
 // A manual exchange must survive longer than the configured connection timeout.
 await Promise.all(pages.map((p,i)=>p.evaluate(role=>window.createSession(role,true,3000),`phone${i+1}`)));
 await pages[0].evaluate(()=>new Promise(resolve=>setTimeout(resolve,3500)));
 const delayedOffer=await pages[0].evaluate(()=>session.pairing.offer());
 await pages[0].evaluate(()=>new Promise(resolve=>setTimeout(resolve,3500)));
 assert.equal(await pages[0].evaluate(()=>session.pairing.status.hasOffer),true);
 const delayedAnswer=await pages[1].evaluate(text=>session.pairing.answer(text),delayedOffer);
 await pages[0].evaluate(()=>new Promise(resolve=>setTimeout(resolve,3500)));
 assert.equal(await pages[0].evaluate(()=>session.pairing.status.hasOffer),true);
 await pages[0].evaluate(text=>session.pairing.applyAnswer(text),delayedAnswer);
 await Promise.all(pages.map(p=>p.evaluate(()=>session.ready())));
 assert.deepEqual(await pages[0].evaluate(async()=>[...(await session.generate('Hello',8)).generated]),golden.cases[0].generated_bytes);
 report.tests.push('idle model and delayed offer/answer copy do not expire the original offer; generation succeeds afterward');
 // Explicit closure is different from spending time on manual text exchange.
 await pair();
 await pages[0].evaluate(()=>session.pairing.close('explicit test reset'));
 await assert.rejects(pages[0].evaluate(()=>session.pairing.applyAnswer('{}')),/no longer active/);
 report.tests.push('explicitly closed offers preserve the closure reason');
 await Promise.all(pages.map((p,i)=>p.evaluate(role=>window.createSession(role,false,1000),`phone${i+1}`)));
 const missingOffer=await pages[0].evaluate(()=>session.pairing.offer());
 const missingAnswer=JSON.parse(await pages[1].evaluate(text=>session.pairing.answer(text),missingOffer));
 missingAnswer.sdp=missingAnswer.sdp.split('\r\n').filter(line=>!line.startsWith('a=candidate:')&&line!=='a=end-of-candidates').join('\r\n');
 await pages[1].evaluate(()=>session.close());
 await pages[0].evaluate(text=>session.pairing.applyAnswer(text),JSON.stringify(missingAnswer));
 await assert.rejects(pages[0].evaluate(()=>session.ready()));
 assert.match(await pages[0].evaluate(()=>session.pairing.status.reason),/AFTER applying|connection lost/i);
 report.tests.push('unreachable peer times out or fails after answer application, preserving real connection deadlines');
 // Reproduce a name-resolution failure with genuine ICE: neither peer receives
 // a resolvable candidate address. The UI must never enable generation.
 await Promise.all(pages.map((p,i)=>p.evaluate(role=>window.createSession(role,false,2000),`phone${i+1}`)));
 const unresolvable=text=>{const signal=JSON.parse(text);signal.sdp=signal.sdp.split('\r\n').map(line=>{
  if(!line.startsWith('a=candidate:'))return line;const fields=line.split(' ');fields[4]='00000000-0000-4000-8000-000000000000.local';return fields.join(' ');
 }).join('\r\n');return JSON.stringify(signal)};
 const dnsOffer=unresolvable(await pages[0].evaluate(()=>session.pairing.offer()));
 const dnsAnswer=unresolvable(await pages[1].evaluate(text=>session.pairing.answer(text),dnsOffer));
 await pages[0].evaluate(text=>session.pairing.applyAnswer(text),dnsAnswer);
 await assert.rejects(pages[0].evaluate(()=>session.ready()));
 assert.equal(await pages[0].locator('#generate').isDisabled(),true);
 assert.match(await pages[0].evaluate(()=>session.pairing.status.reason),/\.local|connection lost/);
 report.tests.push('unresolvable mDNS candidates fail genuine ICE and keep Generate disabled');

 // Exercise the actual visible UI, including the new numeric host path. Use
 // this machine's real LAN address; never disable browser mDNS/privacy flags.
 const lanIP=Object.values(networkInterfaces()).flat().find(entry=>{
  if(!entry||entry.internal||entry.family!=='IPv4')return false;
  try{return !!validateLanIPv4(entry.address)}catch{return false}
 })?.address;
 assert.ok(lanIP,'A private LAN IPv4 is required for the real direct-IP browser test');
 for(let i=0;i<pages.length;i++){
  await pages[i].reload();await pages[i].locator('#role').selectOption(`phone${i+1}`);
  await pages[i].locator('#lan-ip').fill(lanIP);await pages[i].locator('#load').click();
  await pages[i].waitForFunction(()=>document.getElementById('status').textContent.includes('shard verified'));
  assert.equal(await pages[i].locator('#generate').isDisabled(),true);
 }
 await pages[0].locator('#offer').click();await pages[0].waitForFunction(()=>document.getElementById('local').value.length>0);
 const ipOffer=await pages[0].locator('#local').inputValue();assert.ok(!JSON.parse(ipOffer).sdp.includes('.local'));
 await pages[1].locator('#remote').fill(ipOffer);await pages[1].locator('#answer').click();
 await pages[1].waitForFunction(()=>document.getElementById('local').value.length>0);
 const ipAnswer=await pages[1].locator('#local').inputValue();assert.ok(!JSON.parse(ipAnswer).sdp.includes('.local'));
 await pages[0].locator('#remote').fill(ipAnswer);await pages[0].locator('#apply').click();
 await Promise.all(pages.map(p=>p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('CONNECTED'))));
 assert.equal(await pages[0].locator('#generate').isEnabled(),true);
 assert.equal(await pages[1].locator('#generate').isDisabled(),true);
 assert.match(await pages[1].locator('#generation-help').textContent(),/Worker ready/);
 for(const page of pages){assert.deepEqual(await page.evaluate(()=>session.pairing.pc.getConfiguration().iceServers),[]);assert.equal((await page.evaluate(()=>session.pairing.verifyPath())).directHost,true)}
 await pages[0].locator('#prompt').fill('Hello');await pages[0].locator('#count').fill('8');await pages[0].locator('#generate').click();
 await pages[0].waitForFunction(()=>document.getElementById('bytes').textContent==='Generated byte IDs: [63,119,179,184,253,37,243,172]');
 await pages[0].waitForFunction(()=>!document.getElementById('generate').disabled);
 for(const page of pages)assert.equal((await page.evaluate(()=>session.call('stats'))).engine.position,12);
 const numericDiagnostics=await Promise.all(pages.map(page=>page.evaluate(()=>session.pairing.diagnostics())));
 assert.ok(numericDiagnostics.every(s=>s.localCandidates.mdns===0&&s.remoteCandidates.mdns===0&&s.directPathVerified));
 report.directIpUi={generated:golden.cases[0].generated_bytes,phone1GenerateEnabled:true,phone2WorkerOnly:true,diagnostics:numericDiagnostics};
 report.tests.push('real UI numeric Wi-Fi IP offer/answer connects host-to-host, enables Phone 1, generates canonical bytes on both workers');
 await pages[0].locator('#count').fill('500');await pages[0].locator('#generate').click();
 await pages[1].waitForFunction(async()=>(await session.call('stats')).engine.position>20);
 await pages[1].locator('#disconnect').click();await pages[0].waitForFunction(()=>session.pairing.status.closed);
 await pages[0].waitForFunction(()=>document.getElementById('status').textContent.includes('Disconnected')||document.getElementById('status').textContent.includes('closed')||document.getElementById('status').textContent.includes('error'));
 assert.equal(await pages[0].locator('#generate').isDisabled(),true);
 report.tests.push('UI disconnect during generation keeps Generate disabled after the rejected operation');
 for(let i=0;i<roleRequests.length;i++)assert.ok(roleRequests[i].every(path=>path===`/model/phone${i+1}.bin`));
 report.assetRequests=requests;report.roleShardRequests=roleRequests;report.physicalPhonesTested=false;
 await writeFile(new URL('artifacts/reports/milestone4-webrtc.json',root),JSON.stringify(report,null,2)+'\n');
 console.log(`PASS: ${report.tests.length} WebRTC scenarios, 7 golden cases, Chrome ${report.browser}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
