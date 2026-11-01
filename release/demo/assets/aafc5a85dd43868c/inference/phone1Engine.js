import { embedByte } from './embeddings.js';
import { assertByte } from './modelConfig.js';
import { RoleEngine } from './roleEngine.js';
export class Phone1Engine extends RoleEngine {
    #tokens;
    #positions;
    constructor(shard, backend) {
        super('phone1', shard, backend);
        this.#tokens = shard.tensor('token_embedding.weight');
        this.#positions = shard.tensor('position_embedding.weight');
    }
    step(byte, position = this.position) {
        assertByte(byte);
        this.validatePosition(position);
        try {
            embedByte(byte, position, this.#tokens, this.#positions, this.hidden);
            this.runBlocks(position);
            this.finish();
            // Output owns its 1,536 bytes and can be transferred without detaching scratch.
            return this.hidden.slice();
        }
        catch (error) {
            return this.fail(error);
        }
    }
}
