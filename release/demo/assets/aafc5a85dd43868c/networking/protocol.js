import { decodeActivation, encodeActivation } from '../inference/tensor.js';
import { assertByte, assertRole } from '../inference/modelConfig.js';
export const PROTOCOL_VERSION = 1;
export const HEADER_BYTES = 40;
export const MAX_FRAME_BYTES = 2048;
export const NO_POSITION = 0xffff;
export const DEBUG_LOGITS = 1;
const MAGIC = 0x46494d4d; // Wire bytes: M M I F.
export var MessageType;
(function (MessageType) {
    MessageType[MessageType["HELLO"] = 1] = "HELLO";
    MessageType[MessageType["READY"] = 2] = "READY";
    MessageType[MessageType["START"] = 3] = "START";
    MessageType[MessageType["STARTED"] = 4] = "STARTED";
    MessageType[MessageType["ACTIVATION"] = 5] = "ACTIVATION";
    MessageType[MessageType["NEXT_BYTE"] = 6] = "NEXT_BYTE";
    MessageType[MessageType["STOP"] = 7] = "STOP";
    MessageType[MessageType["STOPPED"] = 8] = "STOPPED";
    MessageType[MessageType["ERROR"] = 9] = "ERROR";
    MessageType[MessageType["PING"] = 10] = "PING";
    MessageType[MessageType["PONG"] = 11] = "PONG";
})(MessageType || (MessageType = {}));
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode[ErrorCode["PROTOCOL"] = 1] = "PROTOCOL";
    ErrorCode[ErrorCode["INCOMPATIBLE"] = 2] = "INCOMPATIBLE";
    ErrorCode[ErrorCode["STATE"] = 3] = "STATE";
    ErrorCode[ErrorCode["TIMEOUT"] = 4] = "TIMEOUT";
    ErrorCode[ErrorCode["COMPUTE"] = 5] = "COMPUTE";
    ErrorCode[ErrorCode["CLOSED"] = 6] = "CLOSED";
    ErrorCode[ErrorCode["BACKPRESSURE"] = 7] = "BACKPRESSURE";
})(ErrorCode || (ErrorCode = {}));
export class ProtocolError extends Error {
    code;
    constructor(message, code = ErrorCode.PROTOCOL) {
        super(message);
        this.code = code;
        this.name = 'ProtocolError';
    }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function require(condition, message) {
    if (!condition)
        throw new ProtocolError(message);
}
function uint(value, max = 0xffffffff) { return Number.isInteger(value) && value >= 0 && value <= max; }
function hashBytes(hex, length) {
    require(typeof hex === 'string' && new RegExp(`^[0-9a-f]{${length * 2}}$`).test(hex), 'Invalid hexadecimal identity');
    return Uint8Array.from(hex.match(/../g), x => parseInt(x, 16));
}
function hex(bytes) { return Array.from(bytes, v => v.toString(16).padStart(2, '0')).join(''); }
function validateHeader(h) {
    require(uint(h.type, 11) && h.type >= 1, 'Unsupported message type');
    hashBytes(h.connectionId, 16);
    require(h.connectionId !== '0'.repeat(32), 'Zero connection identity');
    require(uint(h.generation) && uint(h.requestId) && uint(h.flags, 255) && uint(h.position, 65535), 'Invalid header fields');
    const token = h.type === MessageType.ACTIVATION || h.type === MessageType.NEXT_BYTE;
    require(h.flags === 0 || (token && h.flags === DEBUG_LOGITS), 'Unsupported flags');
    require(token ? h.position < 512 : h.position === NO_POSITION, 'Invalid message position');
    if (h.type === MessageType.HELLO || h.type === MessageType.READY) {
        require(h.requestId === 0 && h.generation === 0, 'Handshake must not have request/generation IDs');
    }
    else if (h.type !== MessageType.ERROR) {
        require(h.requestId > 0, 'Request ID must be nonzero');
        if (h.type !== MessageType.PING && h.type !== MessageType.PONG)
            require(h.generation > 0, 'Generation must be nonzero');
    }
}
function payloadFor(message) {
    switch (message.type) {
        case MessageType.HELLO: {
            const h = message.hello;
            require(h, 'Missing HELLO');
            assertRole(h.role);
            require(h.dtype === 'float32' && [h.hidden, h.vocabulary, h.context].every(v => uint(v, 65535) && v > 0), 'Invalid HELLO dimensions/dtype');
            require(h.capabilities === 0 || h.capabilities === DEBUG_LOGITS, 'Unsupported capabilities');
            require(typeof h.modelId === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(h.modelId), 'Invalid model ID');
            const name = encoder.encode(h.modelId), bytes = new Uint8Array(80 + name.length), view = new DataView(bytes.buffer);
            bytes[0] = h.role === 'phone1' ? 1 : 2;
            bytes[1] = 1;
            view.setUint16(2, h.hidden, true);
            view.setUint16(4, h.vocabulary, true);
            view.setUint16(6, h.context, true);
            view.setUint32(8, h.capabilities, true);
            bytes.set(hashBytes(h.configHash, 32), 12);
            bytes.set(hashBytes(h.shardHash, 32), 44);
            view.setUint16(76, name.length, true);
            bytes.set(name, 80);
            return bytes;
        }
        case MessageType.ACTIVATION:
            require(message.activation, 'Missing activation');
            return new Uint8Array(encodeActivation(message.activation));
        case MessageType.NEXT_BYTE: {
            assertByte(message.byte);
            require(typeof message.computeMs === 'number' && Number.isFinite(message.computeMs) && message.computeMs >= 0, 'Invalid compute duration');
            const debug = message.flags === DEBUG_LOGITS;
            require(debug ? message.logits instanceof Float32Array && message.logits.length === 256 : message.logits === undefined, 'Unexpected/missing debug logits');
            const bytes = new Uint8Array(debug ? 1040 : 16), view = new DataView(bytes.buffer);
            bytes[0] = message.byte;
            view.setFloat64(8, message.computeMs, true);
            if (debug)
                for (let i = 0; i < 256; i++) {
                    require(Number.isFinite(message.logits[i]), 'Nonfinite logit');
                    view.setFloat32(16 + i * 4, message.logits[i], true);
                }
            return bytes;
        }
        case MessageType.STOP: {
            require(uint(message.stopReason, 2), 'Invalid stop reason');
            const bytes = new Uint8Array(4);
            bytes[0] = message.stopReason;
            return bytes;
        }
        case MessageType.ERROR: {
            require(uint(message.errorCode, 7) && message.errorCode > 0 && typeof message.errorMessage === 'string', 'Invalid error');
            const text = encoder.encode(message.errorMessage);
            require(text.length <= 256, 'Error text exceeds limit');
            const bytes = new Uint8Array(4 + text.length), view = new DataView(bytes.buffer);
            view.setUint16(0, message.errorCode, true);
            view.setUint16(2, text.length, true);
            bytes.set(text, 4);
            return bytes;
        }
        case MessageType.PING:
        case MessageType.PONG:
            require(message.nonce instanceof Uint8Array && message.nonce.length === 8, 'Invalid ping nonce');
            return message.nonce.slice();
        default: return new Uint8Array(0);
    }
}
export function encodeMessage(message) {
    validateHeader(message);
    const payload = payloadFor(message);
    require(payload.length + HEADER_BYTES <= MAX_FRAME_BYTES, 'Frame exceeds limit');
    const output = new ArrayBuffer(HEADER_BYTES + payload.length), view = new DataView(output), bytes = new Uint8Array(output);
    view.setUint32(0, MAGIC, true);
    view.setUint16(4, PROTOCOL_VERSION, true);
    bytes[6] = message.type;
    bytes[7] = message.flags;
    view.setUint32(8, payload.length, true);
    bytes.set(hashBytes(message.connectionId, 16), 12);
    view.setUint32(28, message.generation, true);
    view.setUint32(32, message.requestId, true);
    view.setUint16(36, message.position, true);
    bytes.set(payload, HEADER_BYTES);
    return output;
}
/** Validate length before allocating or reading untrusted payloads. No JSON tensors. */
export function decodeMessage(input) {
    require(input instanceof ArrayBuffer && input.byteLength >= HEADER_BYTES && input.byteLength <= MAX_FRAME_BYTES, 'Invalid frame size/type');
    const view = new DataView(input), bytes = new Uint8Array(input);
    require(view.getUint32(0, true) === MAGIC, 'Invalid frame magic');
    require(view.getUint16(4, true) === PROTOCOL_VERSION, 'Unsupported protocol version');
    require(view.getUint32(8, true) === input.byteLength - HEADER_BYTES, 'Payload length mismatch');
    require(view.getUint16(38, true) === 0, 'Reserved header bits must be zero');
    const message = { type: bytes[6], flags: bytes[7], connectionId: hex(bytes.subarray(12, 28)),
        generation: view.getUint32(28, true), requestId: view.getUint32(32, true), position: view.getUint16(36, true) };
    validateHeader(message);
    const payload = bytes.subarray(HEADER_BYTES), pv = new DataView(input, HEADER_BYTES);
    switch (message.type) {
        case MessageType.HELLO: {
            require(payload.length >= 81 && payload.length <= 144, 'Invalid HELLO size');
            const length = pv.getUint16(76, true);
            require(length + 80 === payload.length && pv.getUint16(78, true) === 0, 'Invalid HELLO name/reserved fields');
            require((payload[0] === 1 || payload[0] === 2) && payload[1] === 1, 'Unsupported role/dtype');
            message.hello = { role: payload[0] === 1 ? 'phone1' : 'phone2', dtype: 'float32',
                hidden: pv.getUint16(2, true), vocabulary: pv.getUint16(4, true), context: pv.getUint16(6, true),
                capabilities: pv.getUint32(8, true), configHash: hex(payload.subarray(12, 44)), shardHash: hex(payload.subarray(44, 76)),
                modelId: decoder.decode(payload.subarray(80)) };
            break;
        }
        case MessageType.ACTIVATION:
            require(payload.length === 1536, 'Activation must contain exactly 384 FP32 values');
            message.activation = decodeActivation(input.slice(HEADER_BYTES));
            break;
        case MessageType.NEXT_BYTE: {
            const debug = message.flags === DEBUG_LOGITS;
            require(payload.length === (debug ? 1040 : 16), 'Invalid next-byte size');
            require(payload.subarray(1, 8).every(v => v === 0), 'Reserved next-byte fields must be zero');
            message.byte = payload[0];
            message.computeMs = pv.getFloat64(8, true);
            if (debug) {
                message.logits = new Float32Array(256);
                for (let i = 0; i < 256; i++)
                    message.logits[i] = pv.getFloat32(16 + 4 * i, true);
            }
            break;
        }
        case MessageType.STOP:
            require(payload.length === 4 && payload.subarray(1).every(v => v === 0), 'Invalid STOP');
            message.stopReason = payload[0];
            break;
        case MessageType.ERROR:
            require(payload.length >= 4 && payload.length <= 260 && pv.getUint16(2, true) === payload.length - 4, 'Invalid ERROR length');
            message.errorCode = pv.getUint16(0, true);
            message.errorMessage = decoder.decode(payload.subarray(4));
            break;
        case MessageType.PING:
        case MessageType.PONG:
            require(payload.length === 8, 'Invalid ping size');
            message.nonce = payload.slice();
            break;
        default: require(payload.length === 0, 'Unexpected control payload');
    }
    // Share semantic validation with the encoder (including all finite values).
    payloadFor(message);
    return message;
}
export function newConnectionId() { return hex(crypto.getRandomValues(new Uint8Array(16))); }
