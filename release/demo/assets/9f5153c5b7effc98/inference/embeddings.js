import { assertByte, assertPosition } from './modelConfig.js';
export function embedByte(byte, position, tokens, positions, output) {
    assertByte(byte);
    assertPosition(position);
    if (tokens.length !== 256 * 384 || positions.length !== 512 * 384 || output.length !== 384)
        throw new Error('Embedding shape mismatch');
    for (let i = 0; i < 384; i++)
        output[i] = tokens[byte * 384 + i] + positions[position * 384 + i];
}
