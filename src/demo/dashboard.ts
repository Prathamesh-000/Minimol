import { DemoSession } from './session.js';
import { makeQrFrames, QrAssembler } from '../networking/qrPayload.js';
declare const qrcode: any;
declare const jsQR: any;
const el = (id: string) => document.getElementById(id)!;
const text = (id: string, value: string) => { el(id).textContent = value; };
function script(name: string): Promise<void> {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = new URL(`../vendor/${name}.js`, import.meta.url).href; s.onload = () => resolve(); s.onerror = () => reject(new Error('QR library unavailable; use manual pairing')); document.head.append(s); });
}
export function setupDashboard(session: () => DemoSession | undefined) {
  let cached = false, count = 0, started = 0, running = false, frames: string[] = [], index = 0;
  let stream: MediaStream | undefined, scanTimer: ReturnType<typeof setTimeout> | undefined, scanning = false, scanEpoch = 0;
  let encoder: Promise<void> | undefined, decoder: Promise<void> | undefined;
  const loadEncoder = () => encoder ??= script('qrcode').catch(error => { encoder = undefined; throw error; });
  const loadDecoder = () => decoder ??= script('jsQR').catch(error => { decoder = undefined; throw error; });
  const assembler = new QrAssembler();
  const video = el('camera') as HTMLVideoElement;
  const network = () => text('d-network', navigator.onLine ? 'Network available' : 'Browser offline');
  window.addEventListener('online', network); window.addEventListener('offline', network); network();
  const controller = () => { try { return navigator.serviceWorker?.controller; } catch { return undefined; } };
  const offlineState = () => {
    text('offline-state', cached && controller()
      ? 'Shell and assigned shard cached. Offline reload is not yet verified on this device; disconnect Internet while keeping local Wi-Fi and reload.'
      : 'Offline preparation incomplete: cache the shell and load/verify the assigned shard.');
  };
  el('offline').onclick = async () => {
    try {
      text('offline-state', 'Caching application shell and bundled QR/WASM assets…');
      if (!('serviceWorker' in navigator)) throw new Error('Service workers unavailable; use trusted HTTPS. Online demo remains available.');
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      if (registration.waiting) { text('offline-state', 'Update cached. Close ALL miniMol tabs, then reopen to activate safely.'); return; }
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Shell cache installation timed out. Check connectivity/storage and retry.')), 30000))]);
      await navigator.storage?.persist?.(); offlineState();
    } catch (e) { text('offline-state', (e as Error).message); }
  };
  try { navigator.serviceWorker?.addEventListener('controllerchange', offlineState); } catch { text('offline-state','Service Worker access denied; online mode remains available'); }
  function show() {
    const qr = qrcode(0, 'M'); qr.addData(frames[index], 'Byte'); qr.make();
    const canvas = el('qr-canvas') as HTMLCanvasElement, modules = qr.getModuleCount(), scale = 5;
    canvas.width = canvas.height = (modules + 8) * scale;
    // Whole CSS pixels per module avoid uneven downsampling on narrow phones.
    const cssScale = Math.max(1, Math.floor(Math.min(400, canvas.parentElement!.clientWidth - 24) / (modules + 8)));
    canvas.style.width = `${(modules + 8) * cssScale}px`;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) if (qr.isDark(y, x)) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
    canvas.hidden = false; text('qr-status', `Code ${index + 1} of ${frames.length}. Scan all codes; valid for 15 minutes. Use Next code after each scan.`);
  }
  el('show-qr').onclick = async () => { try { if (!session() || session()!.resourceState.closed) throw new Error('This session is closed. Load / retry and create fresh signaling'); const signal = (el('local') as HTMLTextAreaElement).value; if (!signal.trim()) throw new Error(session()!.role === 'phone2' ? 'Phone 2: first Scan other phone, scan every offer code, then press Create answer. Only then show your answer QR.' : 'Phone 1: press Create offer before showing its QR.'); frames = await makeQrFrames(signal); await loadEncoder(); index = 0; show(); } catch (e) { text('qr-status', (e as Error).message + ' Manual text remains available.'); } };
  el('qr-next').onclick = () => { if (frames.length) { index = (index + 1) % frames.length; show(); } };
  el('qr-prev').onclick = () => { if (frames.length) { index = (index + frames.length - 1) % frames.length; show(); } };
  function stop() { scanEpoch++; scanning = false; clearTimeout(scanTimer); stream?.getTracks().forEach(t => t.stop()); stream = undefined; video.srcObject = null; video.hidden = true; }
  async function accept(payload: string) {
    const role = session()?.role; if (!role) throw new Error('Load your selected role first');
    const signal = await assembler.add(payload, role === 'phone1' ? 'answer' : 'offer');
    text('qr-status', `Scanned ${assembler.count} code(s). Keep scanning the remaining codes.`);
    if (signal) { (el('remote') as HTMLTextAreaElement).value = signal; stop(); text('qr-status', 'Complete QR verified. Press ' + (role === 'phone1' ? 'Apply answer.' : 'Create answer.')); }
    return signal;
  }
  // Same decoder path is used by camera frames and automated image tests.
  const decodeImage = async (data: ImageData) => { await loadDecoder(); const code = jsQR(data.data, data.width, data.height); if (code) return accept(code.data); };
  (window as any).decodePairingImage = decodeImage;
  const frameCanvas = document.createElement('canvas');
  async function scan() {
    if (!scanning) return;
    try {
      if (video.readyState >= 2) {
        frameCanvas.width = Math.min(video.videoWidth, 960); frameCanvas.height = Math.round(video.videoHeight * frameCanvas.width / video.videoWidth);
        const ctx = frameCanvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
        await decodeImage(ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height));
      }
    } catch (e) { stop(); text('qr-status', (e as Error).message + ' Stop/restart scanning or use manual text.'); }
    if (scanning) scanTimer = setTimeout(scan, 250);
  }
  el('scan').onclick = async () => {
    stop(); const attempt = scanEpoch; assembler.reset();
    try {
      if (!session() || session()!.resourceState.closed) throw new Error('Load your selected role first');
      if (!window.isSecureContext) throw new Error('Open miniMol over trusted HTTPS to use the camera');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable. Open this URL directly in Safari or Chrome');
      scanning = true;
      text('qr-status', 'Requesting camera permission… Allow camera access to scan the other phone.');
      // Request camera directly from the tap, before any asynchronous library loading.
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      if (!scanning || attempt !== scanEpoch) { media.getTracks().forEach(t => t.stop()); return; }
      stream = media; video.muted = true; video.srcObject = stream; video.hidden = false;
      text('qr-status', 'Opening camera preview…');
      await video.play(); await loadDecoder();
      if (!scanning || attempt !== scanEpoch) return;
      text('qr-status', 'Camera ready. Point at the other phone’s QR and scan every numbered code.');
      video.scrollIntoView({ block: 'center' }); void scan();
    } catch (e) {
      if (attempt !== scanEpoch) return;
      stop(); const error = e as Error;
      const detail = error.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow Camera in this site’s browser settings, then tap Scan other phone again.'
        : error.name === 'NotFoundError' ? 'No camera found on this device.'
        : error.name === 'NotReadableError' ? 'Camera is busy or unavailable. Close other camera apps and retry.' : error.message;
      text('qr-status', 'Camera unavailable: ' + detail + ' Manual text pairing remains available.');
    }
  };
  el('scan-stop').onclick = () => { stop(); text('qr-status', 'Camera stopped. Tap Scan other phone to retry, or use manual text.'); }; window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  let polling = false;
  setInterval(async () => { const current = session(); if (!current?.isReady || polling) return; polling = true; try {
    const stats = await current.call('stats'); if (session() !== current) return;
    text('d-wire', `${stats.send.bytes.toLocaleString()} / ${stats.receivedBytes.toLocaleString()}`);
    const engine = stats.engine; text('d-kv', `${(engine.position * 3 * 2 * 384 * 4 / 1048576).toFixed(2)} / ${(engine.kvBytes / 1048576).toFixed(2)} MiB`);
  } catch { /* Session errors are displayed by existing close handling. */ } finally { polling = false; } }, 1000);
  return {
    closed() { stop(); running = false; text('d-kv','Worker stopped; memory release is browser managed'); },
    loading() { stop(); text('backend','Not loaded'); text('backend-details',''); cached = false; text('d-shard', 'Loading / verifying…'); text('d-kv', 'Not allocated'); text('d-wire', '0 / 0'); offlineState(); },
    loaded(role: string, model: any) { assembler.reset(); frames = []; (el('qr-canvas') as HTMLCanvasElement).hidden = true; cached = model.cached; text('d-layers', role === 'phone1' ? 'Embeddings + layers 0–2' : 'Layers 3–5 + output'); text('d-shard', model.cached ? 'SHA-256 verified · cached' : 'SHA-256 verified · not cached'); text('d-count', role === 'phone1' ? '0' : 'On Phone 1'); text('d-speed', '—'); text('d-kv', '0 / 4.50 MiB'); offlineState(); if (model.cacheWarning) text('offline-state', model.cacheWarning); if (!navigator.onLine && model.cached && controller()) text('offline-state', 'Offline reload verified in this browser: cached shell and SHA-256 verified assigned shard loaded. Peer Wi-Fi is still required.'); },
    start() { count = 0; started = performance.now(); running = true; text('d-count', '0'); text('d-speed', 'Measuring…'); },
    byte() { count++; text('d-count', String(count)); if (running) text('d-speed', (count * 1000 / Math.max(1, performance.now() - started)).toFixed(2)); },
    finish() { if (running) text('d-speed', (count * 1000 / Math.max(1, performance.now() - started)).toFixed(2)); running = false; }
  };
}
