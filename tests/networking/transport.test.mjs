import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedSender } from '../../dist/networking/transport.js';

function fake() { return { readyState: 'open', bufferedAmount: 2048, sent: [], send(frame) { this.sent.push(frame); }, close() { this.readyState = 'closed'; } }; }
test('backpressure queues immutable frames in order and resumes without dropping', async () => {
  const transport = fake(), sender = new BoundedSender(transport, 1000, 2048);
  const first = new Uint8Array(100).fill(1), second = new Uint8Array(100).fill(2);
  const p = sender.send(first.buffer), q = sender.send(second.buffer); first.fill(9);
  assert.equal(transport.sent.length, 0); assert.equal(sender.queuedBytes, 200);
  transport.bufferedAmount = 0; sender.flush(); await Promise.all([p, q]);
  assert.deepEqual(transport.sent.map(b => new Uint8Array(b)[0]), [1, 2]);
  assert.equal(sender.queuedBytes, 0); assert.equal(sender.metrics.backpressureWaits, 2);
});
test('queue overflow rejects explicitly and stalled queues time out', async () => {
  const transport = fake(), sender = new BoundedSender(transport, 30, 2048, 2048, 1);
  const first = sender.send(new ArrayBuffer(100));
  const firstAssertion = assert.rejects(first, /timeout/);
  await assert.rejects(sender.send(new ArrayBuffer(100)), /queue limit/);
  await firstAssertion; assert.equal(sender.queuedBytes, 0);
  await assert.rejects(sender.send(new ArrayBuffer(10)), /closed/);
});
test('close and send exceptions reject all pending frames instead of continuing after a gap', async () => {
  const transport = fake(), sender = new BoundedSender(transport, 1000, 2048);
  const p = sender.send(new ArrayBuffer(1)), q = sender.send(new ArrayBuffer(2));
  const checked = [assert.rejects(p, /send failed/), assert.rejects(q, /send failed/)];
  transport.bufferedAmount = 0; transport.send = () => { throw new Error('send failed'); };
  sender.flush(); await Promise.all(checked); assert.equal(sender.queuedBytes, 0);
  const next = new BoundedSender(fake(), 1000, 2048), pending = next.send(new ArrayBuffer(1));
  const rejected = assert.rejects(pending, /closed by test/); next.close(new Error('closed by test')); await rejected;
});
test('byte metrics count buffers before a Worker-like transport detaches them', async()=>{
 const transport={readyState:'open',bufferedAmount:0,send(frame){structuredClone(frame,{transfer:[frame]})}};
 const sender=new BoundedSender(transport,1000);await sender.send(new ArrayBuffer(1576));sender.tryError(new ArrayBuffer(40));
 assert.equal(sender.metrics.bytes,1616);assert.equal(sender.metrics.frames,2);
});
