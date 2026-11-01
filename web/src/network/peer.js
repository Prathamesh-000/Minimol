// Member 3: offline after load. SDP signaled by QR only; no signaling server or TURN.
import {gzipSync, gunzipSync, strToU8, strFromU8} from 'fflate';

const PREFIX = 'MINIMOL1:';

function base64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text) {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export function encodeSignal(desc) {
  if (!desc || !['offer', 'answer'].includes(desc.type) || typeof desc.sdp !== 'string') throw new Error('Bad SDP');
  return PREFIX + base64Url(gzipSync(strToU8(JSON.stringify({type: desc.type, sdp: desc.sdp})), {level: 9}));
}
export function decodeSignal(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error('QR is not a Minimol pairing signal');
  const desc = JSON.parse(strFromU8(gunzipSync(fromBase64Url(trimmed.slice(PREFIX.length)))));
  if (!desc || !['offer', 'answer'].includes(desc.type) || typeof desc.sdp !== 'string') throw new Error('Corrupt SDP');
  return desc;
}

async function waitIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {cleanup(); reject(new Error('Local ICE gathering timeout'));}, 25000);
    function onChange() { if (pc.iceGatheringState === 'complete') {cleanup(); resolve();} }
    function cleanup() {clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', onChange);}
    pc.addEventListener('icegatheringstatechange', onChange);
    onChange();
  });
}

export class PeerLink {
  constructor({role, onData, onState}) {
    this.role = role;
    this.onData = onData;
    this.onState = onState;
    // No configured STUN/TURN => no external discovery service or relay.
    this.pc = new RTCPeerConnection({iceServers: [], iceTransportPolicy: 'all'});
    this.pc.addEventListener('connectionstatechange', () => this.onState(this.pc.connectionState));
    this.pc.addEventListener('iceconnectionstatechange', () => this.onState(`ICE: ${this.pc.iceConnectionState}`));
    this.pc.addEventListener('datachannel', e => this.attachChannel(e.channel));
    if (role === 'phone1') this.attachChannel(this.pc.createDataChannel('minimol', {ordered: true}));
  }
  attachChannel(dc) {
    this.channel = dc;
    dc.binaryType = 'arraybuffer';
    dc.addEventListener('open', () => this.onState('channel-open'));
    dc.addEventListener('close', () => this.onState('channel-closed'));
    dc.addEventListener('error', () => this.onState('channel-error'));
    dc.addEventListener('message', evt => this.onData(evt.data));
  }
  get open() {return this.channel?.readyState === 'open';}
  send(data) {
    if (!this.open) throw new Error('WebRTC DataChannel is not open');
    this.channel.send(data);
  }
  async createOfferSignal() {
    if (this.role !== 'phone1') throw new Error('Only phone1 offers');
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIceGathering(this.pc);
    return encodeSignal(this.pc.localDescription);
  }
  async answerOfferSignal(signal) {
    if (this.role !== 'phone2') throw new Error('Only phone2 answers');
    const offer = decodeSignal(signal);
    if (offer.type !== 'offer') throw new Error('Expected an offer QR');
    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIceGathering(this.pc);
    return encodeSignal(this.pc.localDescription);
  }
  async acceptAnswerSignal(signal) {
    if (this.role !== 'phone1') throw new Error('Only phone1 accepts answer');
    const answer = decodeSignal(signal);
    if (answer.type !== 'answer') throw new Error('Expected an answer QR');
    await this.pc.setRemoteDescription(answer);
  }
  async selectedConnection() {
    const stats = await this.pc.getStats();
    let pair;
    stats.forEach(s => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && !pair) pair = s;
    });
    if (!pair) return {status: 'pair not yet selected'};
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    return {pairId: pair.id, localType: local?.candidateType, remoteType: remote?.candidateType,
            localProtocol: local?.protocol, remoteProtocol: remote?.protocol};
  }
  close() {this.channel?.close(); this.pc.close();}
}
