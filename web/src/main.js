// Member 3 owns orchestration, UI, and pairing. Member 2 owns the math engine.
import {createEngine} from './engine/engine.js';
import {PeerLink} from './network/peer.js';
import {packActivation, unpackActivation, parseControl, VERSION} from './network/protocol.js';
import {renderQR, scanQR} from './ui/qr.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <h1>Minimol P2P Inference</h1>
  <p class="small">Two phones · one six-layer byte Transformer · direct WebRTC · CPU only</p>
  <section class="card"><h2>1. Choose phone role</h2>
    <button id="choose-a">Phone 1 · Start / Prompt</button>
    <button id="choose-b">Phone 2 · Compute / Reply</button>
    <p id="loading">Choose a role to load only that phone's weights.</p>
  </section>
  <section class="card" id="pairing" hidden><h2>2. Pair the devices</h2>
    <p id="pair-guide"></p>
    <button id="offer" hidden>Create offer QR</button>
    <button id="scan">Scan other phone QR</button>
    <p class="small">If camera scanning fails, paste the pairing text from the other phone below.</p>
    <textarea id="signal-input" placeholder="Paste MINIMOL1:... pairing text here"></textarea>
    <button id="apply-signal">Apply pairing text</button>
    <div id="qr-area" hidden><canvas id="qr-canvas"></canvas><textarea id="signal-output" readonly></textarea></div>
    <video id="camera" autoplay muted playsinline hidden></video>
  </section>
  <section class="card" id="generation" hidden><h2>3. Generate bytes (Phone 1)</h2>
    <label for="prompt">Prompt</label><textarea id="prompt">Hi</textarea>
    <label for="num-bytes">New bytes (max context 512)</label><input id="num-bytes" type="number" min="1" max="32" value="4">
    <button id="run" disabled>Start distributed inference</button>
    <p id="output"></p><code id="hex"></code><p id="metrics" class="small"></p>
  </section>
  <section class="card"><h2>Status / trace</h2><pre id="status">Not initialized</pre><pre id="trace"></pre></section>`;

const $ = id => document.getElementById(id);
let role, engine, modelId, peer, remoteHello = false, ownSequence = 0;
let activeRun = null, pendingReady = null, pendingStep = null, stopScanning = null;
const encoder = new TextEncoder();

function status(message) { $('status').textContent = message; }
function log(message) {
  const stamp = new Date().toLocaleTimeString();
  $('trace').textContent = `[${stamp}] ${message}\n` + $('trace').textContent.slice(0, 6000);
}
function send(msg) { peer.send(JSON.stringify({...msg, version: VERSION})); }
function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  status(`ERROR: ${message}`); log(`ERROR: ${message}`);
  pendingReady?.reject(new Error(message)); pendingReady = null;
  pendingStep?.reject(new Error(message)); pendingStep = null;
  activeRun = null; updateRunButton();
}
function isReady() { return peer?.open && remoteHello && Boolean(engine); }
function updateRunButton() { $('run').disabled = !(role === 'phone1' && isReady()) || Boolean(activeRun); }

async function choose(selected) {
  if (role) return;
  role = selected;
  $('choose-a').disabled = $('choose-b').disabled = true;
  status(`Loading ${role} weights and checking SHA-256 …`);
  try {
    ({engine, modelId} = await createEngine({role}));
    log(`Loaded ${role} half of model, id ${modelId.slice(0, 12)}`);
    peer = new PeerLink({role, onData: data => {
      Promise.resolve(handleData(data)).catch(fail);
    }, onState: async state => {
      log(`WebRTC: ${state}`);
      if (state === 'channel-open') {
        try {
          send({type: 'HELLO', role, modelId});
          const conn = await peer.selectedConnection();
          log(`ICE selected connection: ${JSON.stringify(conn)}`);
        } catch (e) {fail(e);}
      }
      if (state === 'disconnected' || state === 'failed' || state === 'channel-closed') {
        remoteHello = false;
        fail(new Error('P2P connection lost'));
      }
      updateRunButton();
    }});
    $('loading').textContent = `Ready: ${role}, model checksum ${modelId.slice(0, 16)}…`;
    $('pairing').hidden = false;
    $('pair-guide').textContent = role === 'phone1'
      ? 'Phone 1: Create the offer QR. Phone 2 scans it. Then Phone 1 scans the answer QR displayed by Phone 2.'
      : 'Phone 2: Scan the offer QR from Phone 1; your answer QR will appear for Phone 1 to scan.';
    $('offer').hidden = role !== 'phone1';
    $('generation').hidden = role !== 'phone1';
    status('Model loaded. Pair phones on the same local Wi-Fi.');
  } catch (e) {fail(e); $('choose-a').disabled = $('choose-b').disabled = false; role = null;}
}
$('choose-a').addEventListener('click', () => choose('phone1'));
$('choose-b').addEventListener('click', () => choose('phone2'));

async function showSignal(token) {
  $('qr-area').hidden = false;
  $('signal-output').value = token;
  try {await renderQR($('qr-canvas'), token);} catch (e) {
    $('qr-canvas').hidden = true;
    log('QR too dense; use pairing text (or reduce SDP size). ' + e.message);
  }
}
$('offer').addEventListener('click', async () => {
  try {status('Gathering local ICE candidates…'); await showSignal(await peer.createOfferSignal());
       status('Offer QR ready. Scan this from Phone 2.');} catch(e) {fail(e);}
});
async function applySignal(value) {
  if (!peer) throw new Error('Choose role first');
  if (role === 'phone2') {
    status('Accepting offer and gathering answer…');
    const answer = await peer.answerOfferSignal(value);
    await showSignal(answer);
    status('Answer QR ready. Scan it from Phone 1.');
  } else {
    await peer.acceptAnswerSignal(value);
    status('Answer accepted. Waiting for direct DataChannel…');
  }
}
$('apply-signal').addEventListener('click', () => applySignal($('signal-input').value).catch(fail));
$('scan').addEventListener('click', async () => {
  try {
    if (stopScanning) stopScanning();
    $('camera').hidden = false;
    status('Point your camera at the other phone QR');
    stopScanning = await scanQR($('camera'), token => {
      $('camera').hidden = true;
      $('signal-input').value = token;
      applySignal(token).catch(fail);
      stopScanning = null;
    });
  } catch(e) {fail(e);}
});

async function handleData(data) {
  if (data instanceof ArrayBuffer) {
    if (role !== 'phone2') throw new Error('Only phone2 accepts activation frames');
    if (!activeRun) throw new Error('Activation with no active run');
    const frame = unpackActivation(data);
    if (frame.runSequence !== activeRun.runSequence || frame.position !== activeRun.expectedPosition) {
      throw new Error('Stale or out-of-order activation');
    }
    const start = performance.now();
    const result = await engine.forwardActivation({activation: frame.activation, position: frame.position, sample: frame.sample});
    activeRun.expectedPosition++;
    if (frame.sample) {
      send({type: 'BYTE', runId: activeRun.runId, position: frame.position, value: result.byte});
      log(`pos=${frame.position} Phone2 compute=${(performance.now() - start).toFixed(1)}ms byte=${result.byte}`);
    } else {
      send({type: 'STEP_DONE', runId: activeRun.runId, position: frame.position});
      log(`pos=${frame.position} prefilled in ${(performance.now() - start).toFixed(1)}ms`);
    }
    return;
  }
  if (typeof data !== 'string') throw new Error('Unexpected channel data');
  const msg = parseControl(data);
  if (msg.version !== VERSION) throw new Error('Protocol version mismatch');
  if (msg.type === 'HELLO') {
    if (msg.role === role || msg.modelId !== modelId) throw new Error('Role conflict or model hash mismatch');
    remoteHello = true; status('Direct connection established: both model halves match');
    updateRunButton(); log(`Remote HELLO ${msg.role}, matching model ${modelId.slice(0, 12)}`);
    return;
  }
  if (msg.type === 'RUN_START') {
    if (role !== 'phone2' || !remoteHello || activeRun) throw new Error('Invalid RUN_START');
    if (typeof msg.runId !== 'string' || !msg.runId || !Number.isInteger(msg.runSequence) ||
        msg.runSequence <= 0 || !Number.isInteger(msg.promptByteLength) || msg.promptByteLength < 1 ||
        msg.promptByteLength > 512 || !Number.isInteger(msg.maxNewBytes) || msg.maxNewBytes < 1 ||
        msg.maxNewBytes > 513 - msg.promptByteLength) throw new Error('Invalid run metadata');
    engine.reset();
    activeRun = {runId: msg.runId, runSequence: msg.runSequence, expectedPosition: 0};
    send({type: 'READY', runId: msg.runId});
    status('RUN active: Phone 2 computing layers 3–5');
    return;
  }
  if (msg.type === 'READY') {
    if (role !== 'phone1' || !pendingReady || msg.runId !== pendingReady.runId) throw new Error('Unexpected READY');
    const r = pendingReady; pendingReady = null; r.resolve(); return;
  }
  if (msg.type === 'BYTE' || msg.type === 'STEP_DONE') {
    if (role !== 'phone1' || !activeRun || !pendingStep || msg.runId !== activeRun.runId ||
        msg.position !== pendingStep.position || (msg.type === 'BYTE') !== pendingStep.sample) {
      throw new Error('Unexpected BYTE/STEP_DONE');
    }
    if (msg.type === 'BYTE' && (!Number.isInteger(msg.value) || msg.value < 0 || msg.value > 255)) {
      throw new Error('Bad output byte');
    }
    const p = pendingStep; pendingStep = null; p.resolve(msg.type === 'BYTE' ? msg.value : null);
    return;
  }
  if (msg.type === 'END') {
    if (role !== 'phone2' || !activeRun || activeRun.runId !== msg.runId) throw new Error('Unexpected END');
    activeRun = null;
    status('Previous run finished. Ready for next run.');
    return;
  }
  if (msg.type === 'ERROR') {activeRun = null; throw new Error(`Remote error: ${msg.reason}`);}
}

function requestReady(runId) {
  return new Promise((resolve, reject) => {
    if (pendingReady) return reject(new Error('READY already awaited'));
    const timer = setTimeout(() => {pendingReady = null; reject(new Error('READY timed out'));}, 30000);
    pendingReady = {runId, resolve: () => {clearTimeout(timer); resolve();},
                    reject: e => {clearTimeout(timer); reject(e);}};
  });
}
function requestStep(position, sample, runSequence, activation) {
  return new Promise((resolve, reject) => {
    if (pendingStep) return reject(new Error('Step already in flight'));
    const timer = setTimeout(() => {pendingStep = null; reject(new Error('STEP timed out'));}, 90000);
    pendingStep = {position, sample, resolve: x => {clearTimeout(timer); resolve(x);},
                   reject: e => {clearTimeout(timer); reject(e);}};
    try {peer.send(packActivation({runSequence, position, sample, activation}));}
    catch(e) {pendingStep = null; clearTimeout(timer); reject(e);}
  });
}

$('run').addEventListener('click', async () => {
  if (!isReady() || activeRun) return;
  const input = encoder.encode($('prompt').value);
  const desired = Number($('num-bytes').value);
  if (!input.length || input.length > 512) return fail(new Error('Prompt must contain 1..512 UTF-8 bytes'));
  if (!Number.isInteger(desired) || desired < 1 || desired > 32 || desired > 513 - input.length) {
    return fail(new Error('New byte count invalid or context limit exceeded'));
  }
  engine.reset();
  ownSequence = (ownSequence % 0xffffffff) + 1;
  const runId = crypto.randomUUID();
  activeRun = {runId, runSequence: ownSequence};
  updateRunButton();
  $('output').textContent = ''; $('hex').textContent = ''; $('metrics').textContent = '';
  const outputs = [];
  const t0 = performance.now();
  try {
    const ready = requestReady(runId);
    send({type: 'RUN_START', runId, runSequence: ownSequence, promptByteLength: input.length, maxNewBytes: desired});
    await ready;
    status(`Running: ${input.length} prompt bytes, generating ${desired} bytes`);
    let currentToken;
    for (let pos = 0; pos < input.length + desired - 1; pos++) {
      currentToken = pos < input.length ? input[pos] : outputs[pos - input.length];
      const sample = pos >= input.length - 1;
      const start = performance.now();
      const activation = await engine.forwardByte({token: currentToken, position: pos});
      const byte = await requestStep(pos, sample, ownSequence, activation);
      if (sample) {
        outputs.push(byte);
        $('output').textContent = new TextDecoder().decode(Uint8Array.from(outputs));
        $('hex').textContent = outputs.map(x => x.toString(16).padStart(2, '0')).join(' ');
        $('metrics').textContent = `${outputs.length}/${desired} bytes | ${(outputs.length / ((performance.now() - t0) / 1000)).toFixed(2)} bytes/s including prefill`;
      }
      log(`pos=${pos} sample=${sample} round trip=${(performance.now()-start).toFixed(1)}ms`);
      await new Promise(r => setTimeout(r, 0)); // let browser paint after each byte
    }
    send({type: 'END', runId});
    status(`Complete: ${outputs.length} generated bytes across two phones`);
  } catch(e) {
    try {send({type: 'ERROR', runId, reason: String(e.message || e)});} catch { /* channel may be gone */ }
    fail(e);
  } finally {activeRun = null; updateRunButton();}
});
