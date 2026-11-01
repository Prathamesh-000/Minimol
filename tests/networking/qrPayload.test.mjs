import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQrFrames, QrAssembler } from '../../dist/networking/qrPayload.js';
const signal=JSON.stringify({version:1,role:'phone1',type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=x:'+ 'a'.repeat(3000)+'\r\n'});
test('QR chunk reassembly handles reversed order and duplicates without changing signaling',async()=>{
 const frames=await makeQrFrames(signal);const receiver=new QrAssembler();let result;
 for(const frame of frames.toReversed()){result=await receiver.add(frame,'offer');await receiver.add(frame,'offer')}
 assert.equal(result,signal);assert.equal(receiver.count,frames.length);
});
test('QR rejects malformed, expired, future, wrong-role, mixed and corrupted exchanges',async()=>{
 const frames=await makeQrFrames(signal);const p=JSON.parse(frames[0]);
 for(const value of ['null','{','x'.repeat(1801),JSON.stringify({...p,version:2}),JSON.stringify({...p,index:-1}),JSON.stringify({...p,total:221}),JSON.stringify({...p,created:Date.now()-1000000}),JSON.stringify({...p,created:Date.now()+120000})])await assert.rejects(new QrAssembler().add(value,'offer'));
 await assert.rejects(new QrAssembler().add(frames[0],'answer'));
 const a=new QrAssembler();await a.add(frames[0],'offer');await assert.rejects(a.add(JSON.stringify({...p,id:'0'.repeat(64)}),'offer'));
 const corrupt=frames.map(f=>{const p=JSON.parse(f);p.data=p.data.replace('aaaa','bbbb');return JSON.stringify(p)});
 const b=new QrAssembler();await assert.rejects(async()=>{for(const f of corrupt)await b.add(f,'offer')});
});
test('QR export explains missing or incomplete signaling instead of exposing JSON parse errors',async()=>{
 await assert.rejects(makeQrFrames('  '),/Create an offer or answer/);
 await assert.rejects(makeQrFrames('{'),/Incomplete signaling text/);
 await assert.rejects(makeQrFrames('null'),/Invalid signaling type/);
});
