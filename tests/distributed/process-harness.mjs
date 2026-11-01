import { fork } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from '../inference/helpers.mjs';
import { decodeMessage, MAX_FRAME_BYTES } from '../../dist/networking/protocol.js';

export async function processPair(timeout = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'minimol-processes-'));
  const children = [], boots = [], frames = [], pending = new Map();
  let nextId = 0, fault;
  const send = (child, message) => { if (child.connected) child.send(message, error => { if (error) child.disconnect(); }); };
  try {
    for (const role of ['phone1', 'phone2']) {
      const own = join(directory, role); await mkdir(own);
      for (const name of ['manifest.json', `${role}.bin`]) await copyFile(new URL(`public/model/${name}`, root), join(own, name));
      const child = fork(new URL('./runtime-process.mjs', import.meta.url), [role, own, String(timeout)], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const index = children.length; children.push(child);
      const boot = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', code => {
          reject(new Error(`Runtime ${role} exited: ${code}`));
          for (const [id, item] of pending) if (item.index === index) { clearTimeout(item.timer); item.reject(new Error('Runtime process exited')); pending.delete(id); }
          send(children[1 - index] ?? {}, { kind: 'wire-close', reason: 'Peer process exited' });
        });
        child.on('message', message => {
          if (message.kind === 'boot') { boots[index] = message; resolve(message); }
          else if (message.kind === 'reply') {
            const item = pending.get(message.id); if (!item) return;
            pending.delete(message.id); clearTimeout(item.timer);
            if (message.ok) item.resolve(message.result); else item.reject(new Error(message.error));
          } else if (message.kind === 'wire') {
            if (!(message.frame instanceof ArrayBuffer) || message.frame.byteLength > MAX_FRAME_BYTES) { child.kill(); return; }
            const decoded = decodeMessage(message.frame);
            frames.push({ from: role, type: decoded.type, generation: decoded.generation, requestId: decoded.requestId, position: decoded.position, bytes: message.frame.byteLength });
            const frame = fault ? fault(role, message.frame) : message.frame;
            if (frame) send(children[1 - index], { kind: 'wire', frame });
          } else if (message.kind === 'wire-close') send(children[1 - index], message);
        });
      });
      await boot;
    }
    return {
      boots, frames, children,
      setFault(value) { fault = value; },
      command(index, command, data = {}) {
        return new Promise((resolve, reject) => {
          const id = nextId++;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('Harness command timeout')); }, 30000);
          pending.set(id, { index, resolve, reject, timer }); send(children[index], { kind: 'command', id, command, ...data });
        });
      },
      async ready() { await Promise.all([this.command(0, 'start'), this.command(1, 'start')]); },
      async close() {
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Harness closed')); } pending.clear();
        await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode) return resolve(); child.once('exit', resolve); child.kill(); })));
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) { for (const child of children) child.kill(); await rm(directory, { recursive: true, force: true }); throw error; }
}
