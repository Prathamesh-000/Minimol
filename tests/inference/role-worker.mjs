// Node adapter for the same browser-compatible worker runtime. No full weights.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeShard } from '../../dist/inference/weightLoader.js';
import { scalarBackend } from '../../dist/inference/matrixMultiply.js';
import { createWorkerRuntime } from '../../dist/workers/workerRuntime.js';

const { role, directory } = workerData;
const loadedFiles = [];
const handle = createWorkerRuntime(role, async () => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); loadedFiles.push('manifest.json');
  const bytes = await readFile(join(directory, `${role}.bin`)); loadedFiles.push(`${role}.bin`);
  return { shard: await decodeShard(role, manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), backend: scalarBackend, fallbackReasons: [] };
});
let queue = Promise.resolve();
parentPort.on('message', request => {
  queue = queue.then(async () => {
    const { reply, transfer } = await handle(request);
    if (request.type === 'load' && reply.ok) reply.result.loadedFiles = loadedFiles;
    parentPort.postMessage(reply, transfer);
  });
});
