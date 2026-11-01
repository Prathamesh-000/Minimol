// Member 3 owns wire protocol; Member 2 uses this contract without changing it.
export const VERSION = 1;
export const ACTIVATION_LENGTH = 384;
export const FRAME_BYTES = 16 + 4 * ACTIVATION_LENGTH;

export function packActivation({runSequence, position, sample, activation}) {
  if (!(activation instanceof Float32Array) || activation.length !== ACTIVATION_LENGTH) throw new Error('Activation shape error');
  if (!activation.every(Number.isFinite)) throw new Error('Non-finite activation');
  if (!Number.isInteger(runSequence) || runSequence < 1 || runSequence > 0xffffffff) throw new Error('Invalid sequence');
  if (!Number.isInteger(position) || position < 0 || position >= 512) throw new Error('Invalid position');
  const buffer = new ArrayBuffer(FRAME_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, VERSION); view.setUint8(1, 1); view.setUint8(2, sample ? 1 : 0); view.setUint8(3, 0);
  view.setUint32(4, position, true);
  view.setUint32(8, runSequence, true);
  view.setUint32(12, ACTIVATION_LENGTH, true);
  for (let i = 0; i < ACTIVATION_LENGTH; i++) view.setFloat32(16 + 4 * i, activation[i], true);
  return buffer;
}

export function unpackActivation(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== FRAME_BYTES) throw new Error('Wrong frame size');
  const view = new DataView(buffer);
  if (view.getUint8(0) !== VERSION || view.getUint8(1) !== 1 || view.getUint8(3) !== 0 ||
      view.getUint32(12, true) !== ACTIVATION_LENGTH || view.getUint8(2) > 1) throw new Error('Wrong frame header');
  const position = view.getUint32(4, true);
  const runSequence = view.getUint32(8, true);
  if (position >= 512 || runSequence < 1) throw new Error('Out-of-range header');
  const activation = new Float32Array(ACTIVATION_LENGTH);
  for (let i = 0; i < ACTIVATION_LENGTH; i++) {
    const value = view.getFloat32(16 + i * 4, true);
    if (!Number.isFinite(value)) throw new Error('Non-finite activation');
    activation[i] = value;
  }
  return {position, runSequence, sample: Boolean(view.getUint8(2)), activation};
}

export function parseControl(text) {
  const msg = JSON.parse(text);
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new Error('Invalid control message');
  if (!['HELLO', 'RUN_START', 'READY', 'STEP_DONE', 'BYTE', 'ERROR', 'END'].includes(msg.type)) {
    throw new Error(`Unknown control type ${msg.type}`);
  }
  return msg;
}
