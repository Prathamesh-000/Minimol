// Development adapter only. The inference/protocol modules themselves use no Node APIs.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeShard } from '../../dist/inference/weightLoader.js';
import { Phone1Engine } from '../../dist/inference/phone1Engine.js';
import { Phone2Engine } from '../../dist/inference/phone2Engine.js';
import { DistributedRuntime } from '../../dist/distributed/runtime.js';
import { DistributedCoordinator } from '../../dist/distributed/coordinator.js';

const [role, directory, timeout] = process.argv.slice(2);
if (!['phone1', 'phone2'].includes(role)) throw new Error('Invalid process role');
const files = await readdir(directory);
if (files.sort().join(',') !== `manifest.json,${role}.bin`) throw new Error('Directory must contain only the assigned shard and manifest');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const bytes = await readFile(join(directory, `${role}.bin`));
const shard = await decodeShard(role, manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const engine = role === 'phone1' ? new Phone1Engine(shard) : new Phone2Engine(shard);
let events;
const transport = {
  readyState: 'open', bufferedAmount: 0,
  subscribe(value) { events = value; return () => { events = undefined; }; },
  send(frame) {
    if (this.readyState !== 'open') throw new Error('IPC transport closed');
    const size = frame.byteLength; this.bufferedAmount += size;
    process.send({ kind: 'wire', frame }, error => {
      this.bufferedAmount -= size;
      if (error) this.close('IPC write failed'); else events?.writable();
    });
  },
  close(reason) {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; events?.close(reason);
    if (process.connected) process.send({ kind: 'wire-close', reason });
  },
};
const runtime = new DistributedRuntime(engine, transport, manifest, { allowDebug: true, timeoutMs: Number(timeout), handshakeTimeoutMs: Number(timeout) });
const coordinator = role === 'phone1' ? new DistributedCoordinator(runtime) : undefined;
process.on('disconnect', () => { runtime.close(); process.exit(0); });
process.on('message', async message => {
  if (message.kind === 'wire') { events?.message(message.frame); return; }
  if (message.kind === 'wire-close') { transport.close(message.reason); return; }
  if (message.kind !== 'command') return;
  try {
    let result;
    if (message.command === 'start') { await runtime.start(); result = runtime.stats; }
    else if (message.command === 'stats') result = runtime.stats;
    else if (message.command === 'generate') {
      const samples = new Set(message.samplePositions), observed = [];
      result = await coordinator.generate(Uint8Array.from(message.prompt), message.count, { debug: true,
        onStep(step) { if (samples.has(step.position)) observed.push({ position: step.position, activation: step.activation, logits: step.logits, byte: step.byte }); } });
      result = { ...result, observed, stats: runtime.stats };
    } else throw new Error('Unsupported process command');
    if (process.connected) process.send({ kind: 'reply', id: message.id, ok: true, result });
  } catch (error) {
    if (process.connected) process.send({ kind: 'reply', id: message.id, ok: false, error: error.message });
  }
});
process.send({ kind: 'boot', pid: process.pid, role, files, tensorNames: shard.tensorNames, parameterCount: shard.parameterCount, shardHash: shard.hash });
