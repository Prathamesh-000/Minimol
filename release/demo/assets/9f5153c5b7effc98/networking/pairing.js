import { assertRole } from '../inference/modelConfig.js';
import { WebRTCTransport } from './webrtcTransport.js';
import { candidateSummary, validateLanIPv4, withLanAddress } from './lanCandidates.js';
export function parseSignal(text, expected) {
    if (typeof text !== 'string' || text.length > 65536)
        throw new Error('Signaling text exceeds 64 KiB');
    let signal;
    try {
        signal = JSON.parse(text);
    }
    catch {
        throw new Error('Paste the complete miniMol offer/answer JSON');
    }
    if (!signal || signal.version !== 1 || signal.type !== expected || signal.role !== (expected === 'offer' ? 'phone1' : 'phone2')
        || typeof signal.sdp !== 'string' || signal.sdp.length > 60000 || !signal.sdp.startsWith('v=0\r\n') || !signal.sdp.includes('m=application '))
        throw new Error('Invalid or incompatible signaling message');
    for (const line of signal.sdp.split(/\r?\n/))
        if (line.startsWith('a=candidate:') && !/ typ host(?: |$)/.test(line))
            throw new Error('Only direct host ICE candidates are permitted');
    return signal;
}
/** No ICE servers, cloud signaling, candidate trickling or relay fallback. */
export class PeerPairing {
    role;
    timeoutMs;
    pc = new RTCPeerConnection({ iceServers: [] });
    #channel;
    #transport;
    #used = false;
    get dataChannel() { return this.#channel; }
    #closed = false;
    #closeReason = '';
    #pathVerified = false;
    #exportedSdp = '';
    #remoteSdp = '';
    #lanIPv4 = '';
    #events = [];
    #started = performance.now();
    #pairs = [];
    #diagnosing = false;
    get status() { return { role: this.role, closed: this.#closed, reason: this.#closeReason, signaling: this.pc.signalingState, ice: this.pc.iceConnectionState, gathering: this.pc.iceGatheringState, connection: this.pc.connectionState, channel: this.#channel?.readyState ?? 'not received', directPathVerified: this.#pathVerified, hasOffer: this.#used && this.pc.signalingState === 'have-local-offer', deadline: this.#timer ? 'connection attempt' : 'none', addressMode: this.#lanIPv4 ? 'explicit Wi-Fi IPv4' : 'browser candidates', localCandidates: candidateSummary(this.#exportedSdp), remoteCandidates: candidateSummary(this.#remoteSdp), candidatePairs: this.#pairs, events: this.#events.slice() }; }
    #resolve;
    #reject;
    connected = new Promise((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    #timer;
    constructor(role, timeoutMs = 180000) {
        this.role = role;
        this.timeoutMs = timeoutMs;
        assertRole(role);
        void this.connected.catch(() => { });
        for (const name of ['iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange', 'connectionstatechange']) {
            this.pc.addEventListener(name, () => this.record(`${name}: ${this.pc.iceConnectionState}/${this.pc.connectionState}/${this.pc.signalingState}`));
        }
        this.pc.addEventListener('icecandidateerror', event => this.record(`ICE candidate error ${event.errorCode}`));
        this.pc.ondatachannel = event => {
            if (role !== 'phone2' || this.#channel) {
                event.channel.close();
                this.close('Duplicate/unexpected DataChannel');
            }
            else
                this.acceptChannel(event.channel);
        };
        this.pc.onconnectionstatechange = () => {
            if (['failed', 'disconnected', 'closed'].includes(this.pc.connectionState))
                this.close('Peer connection lost. Keep both phones awake and retry pairing on the same local network.');
        };
    }
    record(event) {
        this.#events.push({ event, seconds: Math.round((performance.now() - this.#started) / 1000) });
        if (this.#events.length > 32)
            this.#events.shift();
    }
    async diagnostics() {
        if (!this.#closed && !this.#diagnosing) {
            this.#diagnosing = true;
            try {
                const pairs = [];
                (await this.pc.getStats()).forEach(stat => {
                    if (stat.type === 'candidate-pair')
                        pairs.push({ state: stat.state, nominated: stat.nominated,
                            requestsSent: stat.requestsSent, responsesReceived: stat.responsesReceived,
                            requestsReceived: stat.requestsReceived, bytesSent: stat.bytesSent, bytesReceived: stat.bytesReceived });
                });
                this.#pairs = pairs.slice(0, 16);
            }
            catch { /* Retain last available diagnostics, including after a browser closes ICE. */ }
            finally {
                this.#diagnosing = false;
            }
        }
        return this.status;
    }
    exportSignal(type, lanIPv4) {
        this.#lanIPv4 = lanIPv4;
        this.#exportedSdp = withLanAddress(this.pc.localDescription.sdp, lanIPv4);
        if (!candidateSummary(this.#exportedSdp).total)
            throw new Error('No local ICE candidates. Open the page directly in Safari/Chrome and check local-network access.');
        this.record(`${type} exported (${lanIPv4 ? 'explicit Wi-Fi IPv4' : 'browser addresses'})`);
        return JSON.stringify({ version: 1, role: this.role, type, sdp: this.#exportedSdp });
    }
    startDeadline() {
        clearTimeout(this.#timer);
        if (this.#pathVerified || this.#closed)
            return;
        this.#timer = setTimeout(() => this.close('Direct connection timed out AFTER applying the answer. ' +
            (candidateSummary(this.#remoteSdp).mdns ? "The peer still advertised .local addresses. Enter each phone's own Wi-Fi IPv4 before creating a fresh offer/answer. " : "The peer advertised a numeric address but no verified path opened. Check both Wi-Fi IPs and local-network permission; this network may block peer UDP traffic. ") +
            'If both addresses are correct, use a non-guest Wi-Fi with client isolation disabled. No relay fallback is permitted.'), this.timeoutMs);
    }
    acceptChannel(channel) {
        if (channel.label !== 'minimol-v1' || channel.protocol !== 'minimol-binary-v1') {
            channel.close();
            this.close('Unexpected channel');
            return;
        }
        this.#channel = channel;
        try {
            this.#transport = new WebRTCTransport(channel);
        }
        catch {
            this.close('Unreliable channel rejected');
            return;
        }
        let opening = false;
        const opened = () => {
            if (opening || this.#closed)
                return;
            opening = true;
            this.record('DataChannel open; verifying selected path');
            void this.verifyPath().then(() => { if (!this.#closed) {
                this.#pathVerified = true;
                clearTimeout(this.#timer);
                this.#timer = undefined;
                this.#resolve(this.#transport);
            } }).catch(error => this.close(error.message));
        };
        channel.addEventListener('open', opened, { once: true });
        // Some browsers deliver the remote channel with readyState already open.
        if (channel.readyState === 'open')
            queueMicrotask(opened);
        channel.addEventListener('close', () => this.close('DataChannel closed'), { once: true });
    }
    async gather() {
        if (this.pc.iceGatheringState === 'complete')
            return;
        await new Promise((resolve, reject) => {
            const finish = (error) => { clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', change); this.pc.removeEventListener('connectionstatechange', closed); error ? reject(error) : resolve(); };
            const change = () => { if (this.pc.iceGatheringState === 'complete')
                finish(); };
            const closed = () => { if (this.pc.connectionState === 'closed')
                finish(new Error('Pairing cancelled')); };
            const timer = setTimeout(() => finish(new Error('ICE gathering timeout; retry on a compatible local network')), Math.min(this.timeoutMs, 15000));
            this.pc.addEventListener('icegatheringstatechange', change);
            this.pc.addEventListener('connectionstatechange', closed);
            change();
        });
    }
    async offer(lanIPv4 = '') {
        if (this.role !== 'phone1' || this.#used || this.#closed)
            throw new Error('Create a fresh Phone 1 pairing for an offer');
        lanIPv4 = lanIPv4.trim();
        if (lanIPv4.trim())
            lanIPv4 = validateLanIPv4(lanIPv4);
        this.#used = true;
        this.acceptChannel(this.pc.createDataChannel('minimol-v1', { ordered: true, protocol: 'minimol-binary-v1' }));
        try {
            await this.pc.setLocalDescription(await this.pc.createOffer());
            await this.gather();
            return this.exportSignal('offer', lanIPv4);
        }
        catch (error) {
            this.close('Offer creation failed');
            throw error;
        }
    }
    async answer(text, lanIPv4 = '') {
        if (this.role !== 'phone2' || this.#used || this.#closed)
            throw new Error('Create a fresh Phone 2 pairing for an answer');
        lanIPv4 = lanIPv4.trim();
        if (lanIPv4.trim())
            lanIPv4 = validateLanIPv4(lanIPv4);
        const signal = parseSignal(text, 'offer');
        this.#used = true;
        try {
            this.#remoteSdp = signal.sdp;
            await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            await this.gather();
            return this.exportSignal('answer', lanIPv4);
        }
        catch (error) {
            this.close('Answer creation failed');
            throw error;
        }
    }
    async applyAnswer(text) {
        if (this.#closed)
            throw new Error(`This offer is no longer active: ${this.#closeReason} Reload both roles and exchange a NEW offer and answer.`);
        if (this.role !== 'phone1' || !this.#used)
            throw new Error('Create an offer on this Phone 1 page first. Keep this same page open until its answer is applied.');
        if (this.pc.signalingState === 'stable' && this.pc.remoteDescription?.type === 'answer')
            throw new Error('Answer already applied. Wait for connection; if it fails, retry both roles with a new offer.');
        if (this.pc.signalingState !== 'have-local-offer')
            throw new Error(`Offer is unavailable (signaling: ${this.pc.signalingState}). Retry both roles with a fresh offer.`);
        const signal = parseSignal(text, 'answer');
        try {
            this.#remoteSdp = signal.sdp;
            await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            this.record('Answer applied');
            this.startDeadline();
        }
        catch (error) {
            this.close('Remote answer rejected');
            throw error;
        }
    }
    async verifyPath() {
        // Some browsers publish selected-pair stats a little after the open event.
        for (let attempt = 0; attempt < 20; attempt++) {
            const report = await this.pc.getStats();
            const stats = new Map();
            report.forEach(s => stats.set(s.id, s));
            let pair;
            stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId)
                pair = stats.get(s.selectedCandidatePairId); });
            if (!pair)
                stats.forEach(s => { if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated)
                    pair = s; });
            if (pair) {
                const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
                if (local?.candidateType === 'host' && remote?.candidateType === 'host')
                    return { directHost: true, localType: 'host', remoteType: 'host' };
                if (local?.candidateType && remote?.candidateType)
                    throw new Error('Selected ICE path is not direct host-to-host');
            }
            if (this.#closed)
                throw new Error('Pairing closed');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Cannot verify the selected direct host path in this browser');
    }
    close(reason = 'Disconnected; create a fresh offer/answer to reconnect') {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#closeReason = reason;
        this.record(reason);
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#reject(new Error(reason));
        this.#transport?.close(reason);
        this.pc.close();
    }
}
