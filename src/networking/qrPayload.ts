import { parseSignal } from './pairing.js';
const LIMIT = 220, TTL = 15 * 60 * 1000;
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function makeQrFrames(signal: string, now = Date.now()): Promise<string[]> {
  if (!signal.trim()) throw new Error('Create an offer or answer before showing QR codes');
  let parsed: any; try { parsed = JSON.parse(signal); } catch { throw new Error('Incomplete signaling text; create a fresh offer or answer'); }
  const type = parsed?.type; if (type !== 'offer' && type !== 'answer') throw new Error('Invalid signaling type'); parseSignal(signal, type);
  const id = await digest(signal), total = Math.ceil(signal.length / 320);
  if (total > LIMIT) throw new Error('Signaling too large for QR; use manual text');
  return Array.from({ length: total }, (_, index) => JSON.stringify({ qr: 'miniMol', version: 1, id, type, created: now, total, index, data: signal.slice(index * 320, (index + 1) * 320) }));
}
export class QrAssembler {
  private header = ''; private parts = new Map<number, string>();
  reset() { this.header = ''; this.parts.clear(); }
  get count() { return this.parts.size; }
  async add(text: string, expected: 'offer' | 'answer', now = Date.now()): Promise<string | undefined> {
    if (text.length > 1800) throw new Error('QR payload too large');
    let p: any; try { p = JSON.parse(text); } catch { throw new Error('Invalid miniMol QR'); }
    if (!p || p.qr !== 'miniMol' || p.version !== 1 || p.type !== expected || !/^[a-f0-9]{64}$/.test(p.id)
      || !Number.isInteger(p.created) || p.created > now + 60000 || now - p.created > TTL
      || !Number.isInteger(p.total) || p.total < 1 || p.total > LIMIT || !Number.isInteger(p.index) || p.index < 0 || p.index >= p.total
      || typeof p.data !== 'string' || p.data.length > 320) throw new Error('Wrong role, expired or malformed QR. Create fresh QR codes or use manual text.');
    const header = JSON.stringify([p.id, p.type, p.created, p.total]);
    if (this.header && this.header !== header) throw new Error('Mixed QR exchanges; stop and restart the scanner');
    this.header = header;
    if (this.parts.has(p.index) && this.parts.get(p.index) !== p.data) throw new Error('Conflicting QR chunk');
    this.parts.set(p.index, p.data);
    if (this.parts.size !== p.total) return;
    const signal = Array.from({ length: p.total }, (_, i) => this.parts.get(i)!).join('');
    if (await digest(signal) !== p.id) throw new Error('QR checksum mismatch');
    parseSignal(signal, expected); return signal;
  }
}
