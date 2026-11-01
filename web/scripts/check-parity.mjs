// Member 2: execute after Member 1's `python ml/export_weights.py`.
import {readFileSync} from 'node:fs';
import {createEngineFromBuffers} from '../src/engine/engine.js';

const base = new URL('../public/model/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
const fixtures = JSON.parse(readFileSync(new URL('fixtures.json', base), 'utf8'));
function load(role) {
  const raw = readFileSync(new URL(`${role}.bin`, base));
  const binary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return createEngineFromBuffers({role, manifest, binary});
}

const tolerance = fixtures.comparisonAbsTolerance;
let worstCut = 0;
let worstLogit = 0;
for (const run of fixtures.runs) {
  const a = load('phone1');
  const b = load('phone2');
  let context = [...run.promptBytes];
  let actualOutputs = [];
  let fixtureIndex = 0;
  for (let pos = 0; pos < run.steps.at(-1).position + 1; pos++) {
    const activation = await a.forwardByte({token: context[pos], position: pos});
    const expected = run.steps.find(step => step.position === pos);
    if (expected) {
      for (let j = 0; j < 384; j++) worstCut = Math.max(worstCut, Math.abs(activation[j] - expected.cut[j]));
    }
    const response = await b.forwardActivation({activation, position: pos, sample: Boolean(expected)});
    if (expected) {
      if (response.byte !== expected.predictedByte) {
        throw new Error(`Greedy byte mismatch for '${run.prompt}' position=${pos}: got=${response.byte}, expected=${expected.predictedByte}`);
      }
      for (let j = 0; j < 256; j++) worstLogit = Math.max(worstLogit, Math.abs(response.logits[j] - expected.logits[j]));
      context.push(response.byte);
      actualOutputs.push(response.byte);
    }
  }
  console.log(`PASS '${run.prompt}' => [${actualOutputs.join(', ')}]`);
}
console.log(`Maximum |cut diff|=${worstCut.toFixed(6)} |logit diff|=${worstLogit.toFixed(6)}`);
if (worstCut > tolerance || worstLogit > tolerance) throw new Error(`Numerical tolerance exceeded: ${tolerance}`);
console.log('PASS Python/JS parity (provisional canonical model)');
