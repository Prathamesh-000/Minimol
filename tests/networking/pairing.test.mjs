import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSignal } from '../../dist/networking/pairing.js';
test('manual signaling validates size, version, opposite role, type and application SDP',()=>{
 const good={version:1,role:'phone1',type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'};
 assert.equal(parseSignal(JSON.stringify(good),'offer').role,'phone1');
 for(const change of [{version:2},{role:'phone2'},{type:'answer'},{sdp:'invalid'}])assert.throws(()=>parseSignal(JSON.stringify({...good,...change}),'offer'));
 for(const value of ['{','null','x'.repeat(65537)])assert.throws(()=>parseSignal(value,'offer'));
});
test('signaling rejects relay and server-reflexive candidates, accepting host candidates only',()=>{
 for(const type of ['relay','srflx','prflx','host']){
  const value=JSON.stringify({version:1,role:'phone2',type:'answer',sdp:`v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 1 192.0.2.1 1234 typ ${type}\r\n`});
  if(type==='host')assert.equal(parseSignal(value,'answer').role,'phone2');else assert.throws(()=>parseSignal(value,'answer'),/host/);
 }
});
