/** Presence/probe results, never a claim of physical compatibility. No UA branching. */
export function capabilities() {
  let transfer = false, serviceWorker = false;
  try { const buffer = new ArrayBuffer(1); structuredClone(buffer, {transfer:[buffer]}); transfer = buffer.byteLength === 0; } catch {}
  try { serviceWorker = 'serviceWorker' in navigator && !!navigator.serviceWorker; } catch {}
  return {scope:'API presence and tiny transfer probe only; actual device behavior requires testing',secureContext:globalThis.isSecureContext,
    webCrypto:!!globalThis.crypto?.subtle,workerApi:typeof Worker === 'function',moduleWorkers:'confirmed only by successful model Worker load',
    webRTC:typeof RTCPeerConnection === 'function',wasmApi:typeof WebAssembly === 'object',simd:'confirmed only by successful SIMD backend instantiation',
    transferableArrayBuffer:transfer,sharedArrayBufferRequired:false,cacheStorage:typeof caches !== 'undefined',serviceWorker,
    indexedDBApi:typeof indexedDB !== 'undefined',indexedDBRequired:false,cameraApi:!!navigator.mediaDevices?.getUserMedia,
    visibility:'visibilityState' in document,wasDiscarded:'wasDiscarded' in document?(document as any).wasDiscarded:null};
}
