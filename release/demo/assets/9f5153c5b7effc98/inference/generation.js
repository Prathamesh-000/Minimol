import { assertByte } from './modelConfig.js';
export function promptBytes(prompt) {
    const bytes = typeof prompt === 'string' ? new TextEncoder().encode(prompt) : prompt;
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 512)
        throw new Error('Prompt must contain 1–512 UTF-8 bytes');
    return bytes.slice();
}
/** Prefill sends every prompt byte through both roles, then feeds back only the
 * last prediction. Cache positions never restart between prefill and generation.
 */
export async function generate(transport, prompt, maxNewBytes, options = {}) {
    const bytes = promptBytes(prompt);
    if (!Number.isInteger(maxNewBytes) || maxNewBytes < 0)
        throw new Error('maxNewBytes must be a nonnegative integer');
    const generated = [];
    let position = 0, predicted = 0;
    const result = (stopReason) => ({ generated: Uint8Array.from(generated), inputBytes: bytes.length, processedPositions: position, stopReason });
    await transport.reset();
    if (maxNewBytes === 0)
        return result('length');
    try {
        for (const byte of bytes) {
            if (options.signal?.aborted) {
                await transport.reset();
                return result('aborted');
            }
            predicted = await transport.step(byte, position++);
            assertByte(predicted);
        }
        while (generated.length < maxNewBytes) {
            if (options.signal?.aborted) {
                await transport.reset();
                return result('aborted');
            }
            generated.push(predicted);
            options.onByte?.(predicted);
            if (generated.length === maxNewBytes)
                return result('length');
            if (position === 512)
                return result('context');
            predicted = await transport.step(predicted, position++);
            assertByte(predicted);
        }
        return result('length');
    }
    catch (error) {
        await transport.reset();
        throw error;
    }
}
