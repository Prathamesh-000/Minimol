import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessage, MessageType as T, NO_POSITION, DEBUG_LOGITS, HEADER_BYTES } from '../../dist/networking/protocol.js';
import { manifest } from '../inference/helpers.mjs';

const base = { connectionId: '0102030405060708090a0b0c0d0e0f10', generation: 1, requestId: 7, position: NO_POSITION, flags: 0 };
const hello = { role: 'phone1', hidden: 384, vocabulary: 256, context: 512, dtype: 'float32', capabilities: DEBUG_LOGITS,
  modelId: manifest.model_config.model_id, configHash: manifest.config_sha256, shardHash: manifest.files.phone1.sha256 };
const activation = Float32Array.from({ length: 384 }, (_, i) => (i - 192) / 3);

test('binary HELLO roundtrip preserves all compatibility fields and uses protocol version 1', () => {
  const bytes = encodeMessage({ ...base, type: T.HELLO, generation: 0, requestId: 0, hello });
  assert.deepEqual(decodeMessage(bytes).hello, hello);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'MMIF');
  assert.equal(new DataView(bytes).getUint16(4, true), 1);
  assert.equal(decodeMessage(bytes).connectionId, base.connectionId);
});

test('ACTIVATION has exactly 384 explicitly little-endian FP32 values plus a 40-byte header', () => {
  const frame = encodeMessage({ ...base, type: T.ACTIVATION, position: 511, activation });
  assert.equal(frame.byteLength, 1576); assert.equal(HEADER_BYTES, 40);
  assert.equal(new DataView(frame).getFloat32(40, true), -64);
  assert.deepEqual(decodeMessage(frame).activation, activation);
  assert.equal(decodeMessage(frame).requestId, 7); assert.equal(decodeMessage(frame).position, 511);
});

test('NEXT_BYTE carries one byte and local duration; 256 logits require explicit debug flag', () => {
  const normal = encodeMessage({ ...base, type: T.NEXT_BYTE, position: 0, byte: 255, computeMs: 12.25 });
  assert.equal(normal.byteLength, 56); assert.equal(decodeMessage(normal).byte, 255);
  assert.equal(decodeMessage(normal).computeMs, 12.25); assert.equal(decodeMessage(normal).logits, undefined);
  const logits = Float32Array.from({ length: 256 }, (_, i) => i / 10);
  const debug = encodeMessage({ ...base, type: T.NEXT_BYTE, position: 0, byte: 255, computeMs: 0, flags: 1, logits });
  assert.equal(debug.byteLength, 1080); assert.deepEqual(decodeMessage(debug).logits, logits);
  assert.throws(() => encodeMessage({ ...base, type: T.NEXT_BYTE, position: 0, byte: 255, computeMs: 0, logits }), /debug/);
});

test('control, error and ping messages roundtrip with strict sizes', () => {
  for (const type of [T.START, T.STARTED, T.STOPPED]) assert.equal(encodeMessage({ ...base, type }).byteLength, 40);
  assert.equal(decodeMessage(encodeMessage({ ...base, type: T.STOP, stopReason: 2 })).stopReason, 2);
  assert.equal(decodeMessage(encodeMessage({ ...base, type: T.ERROR, errorCode: 3, errorMessage: 'Bad state' })).errorMessage, 'Bad state');
  for (const type of [T.PING, T.PONG]) assert.deepEqual(decodeMessage(encodeMessage({ ...base, type, nonce: new Uint8Array(8).fill(12) })).nonce, new Uint8Array(8).fill(12));
});

test('malformed headers, mismatched lengths and non-binary/oversized input are rejected', () => {
  const original = encodeMessage({ ...base, type: T.ACTIVATION, position: 0, activation });
  for (const mutate of [
    v => v.setUint32(0, 0, true), v => v.setUint16(4, 2, true), v => v.setUint8(6, 255),
    v => v.setUint8(7, 2), v => v.setUint32(8, 0xffffffff, true), v => v.setUint32(28, 0, true),
    v => v.setUint32(32, 0, true), v => v.setUint16(36, 512, true), v => v.setUint16(38, 1, true),
    v => { for (let i = 12; i < 28; i++) v.setUint8(i, 0); },
  ]) { const frame = original.slice(0); mutate(new DataView(frame)); assert.throws(() => decodeMessage(frame)); }
  for (const value of ['text', new Uint8Array(original), new ArrayBuffer(4096), original.slice(4), original.slice(0, 39)]) assert.throws(() => decodeMessage(value));
});

test('malformed payloads, nonfinite activations/logits/timings and reserved fields are rejected', () => {
  const a = encodeMessage({ ...base, type: T.ACTIVATION, position: 0, activation });
  for (const value of [NaN, Infinity, -Infinity]) { const bad = a.slice(0); new DataView(bad).setFloat32(40, value, true); assert.throws(() => decodeMessage(bad), /Nonfinite/); }
  const next = encodeMessage({ ...base, type: T.NEXT_BYTE, position: 0, byte: 0, computeMs: 0, flags: 1, logits: new Float32Array(256) });
  for (const mutate of [v => v.setUint8(41, 1), v => v.setFloat64(48, NaN, true), v => v.setFloat64(48, -1, true), v => v.setFloat32(56, Infinity, true)]) {
    const bad = next.slice(0); mutate(new DataView(bad)); assert.throws(() => decodeMessage(bad));
  }
  const malformed = a.slice(0, a.byteLength - 4); new DataView(malformed).setUint32(8, 1532, true);
  assert.throws(() => decodeMessage(malformed), /exactly 384/);
  const badHello = encodeMessage({ ...base, type: T.HELLO, generation: 0, requestId: 0, hello });
  new DataView(badHello).setUint8(41, 2); assert.throws(() => decodeMessage(badHello), /dtype/);
  assert.throws(() => encodeMessage({ ...base, type: T.ERROR, errorCode: 3, errorMessage: 'x'.repeat(257) }), /limit/);
});
