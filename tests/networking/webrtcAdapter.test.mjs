import test from 'node:test';
import assert from 'node:assert/strict';
import {WebRTCTransport} from '../../dist/networking/webrtcTransport.js';
import {BoundedSender} from '../../dist/networking/transport.js';
class Channel extends EventTarget {ordered=true;maxRetransmits=null;maxPacketLifeTime=null;readyState='open';bufferedAmount=0;bufferedAmountLowThreshold=0;binaryType='';send(frame){this.bufferedAmount+=frame.byteLength}close(){this.readyState='closed';this.dispatchEvent(new Event('close'))}}
test('drain polling resumes real adapter backpressure even without a low-buffer event',async()=>{
 const channel=new Channel(),t=new WebRTCTransport(channel),s=new BoundedSender(t,1000);let closes=0;
 t.subscribe({message(){},writable(){s.flush()},close(){closes++}});
 channel.bufferedAmount=16000;t.send(new ArrayBuffer(1000));const waiting=s.send(new ArrayBuffer(100));assert.equal(s.queuedBytes,100);
 channel.bufferedAmount=0;await waiting;assert.equal(s.queuedBytes,0);t.close('done');assert.equal(closes,1);assert.equal(t.readyState,'closed');
});
test('invalid binary messages and startup queue overflow fail closed and release listeners',()=>{
 for(const value of ['text',new Uint8Array(40),new ArrayBuffer(39),new ArrayBuffer(2049)]){const c=new Channel(),t=new WebRTCTransport(c);t.subscribe({message(){assert.fail('invalid frame accepted')},writable(){},close(){}});c.dispatchEvent(new MessageEvent('message',{data:value}));assert.equal(t.readyState,'closed')}
 const c=new Channel(),t=new WebRTCTransport(c);for(let i=0;i<9;i++)c.dispatchEvent(new MessageEvent('message',{data:new ArrayBuffer(40)}));assert.equal(t.readyState,'closed');
});
