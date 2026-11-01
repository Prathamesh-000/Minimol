/** Development validation only. The driver moves bytes between two browser pages;
 * it is not a production transport, WebRTC implementation, or phone benchmark.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const golden = JSON.parse(await readFile(new URL('tests/fixtures/golden_vectors.json', root), 'utf8'));
const assetRequests = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  let file, contentType = 'application/octet-stream';
  if (pathname === '/test.html') { file = 'tests/browser/role.html'; contentType = 'text/html'; }
  else if (/^\/dist\/(inference|workers)\/[a-zA-Z0-9]+(?:\.worker)?\.js$/.test(pathname)) { file = pathname.slice(1); contentType = 'text/javascript'; }
  else if (/^\/wasm\/matrix-(scalar|simd)\.wasm$/.test(pathname)) { file = `public${pathname}`; contentType = 'application/wasm'; }
  else {
    const match = /^\/(phone[12])\/model\/(manifest\.json|phone[12]\.bin)$/.exec(pathname);
    if (match && (match[2] === 'manifest.json' || match[2] === `${match[1]}.bin`)) {
      file = `public/model/${match[2]}`; assetRequests.push({ role: match[1], file: match[2] });
      if (match[2] === 'manifest.json') contentType = 'application/json';
    }
  }
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  try { const data = await readFile(new URL(file, root)); response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(data); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const check = (actual, expected) => {
  assert.equal(actual.length, expected.length); let maximum = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    assert.ok(Number.isFinite(actual[i]) && error <= 1e-4 + 1e-4 * Math.abs(expected[i]), `value ${i}: error ${error}`);
    maximum = Math.max(maximum, error);
  }
  return maximum;
};
try {
  browser = await chromium.launch({ executablePath: process.env.MINIMOL_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const report = { browser: browser.version(), platform: `${process.platform}-${process.arch}`, transport: 'local test driver between two browser contexts (not WebRTC)', backends: [] };
  for (const backend of ['typescript', 'wasm-scalar', 'wasm-simd']) {
    const contexts = [await browser.newContext(), await browser.newContext()], pages = await Promise.all(contexts.map(c => c.newPage()));
    const errors = [], assetStart = assetRequests.length;
    for (let i = 0; i < 2; i++) {
      pages[i].on('pageerror', error => errors.push(error.message));
      await pages[i].goto(`${origin}/test.html?role=phone${i + 1}&backend=${backend}`);
      const loaded = await pages[i].evaluate(() => window.ready);
      assert.equal(loaded.backend, backend === 'typescript' ? 'typescript-scalar' : backend);
      assert.deepEqual(loaded.layerIds, i === 0 ? [0, 1, 2] : [3, 4, 5]);
      assert.equal(loaded.kvBytes, 4718592); assert.deepEqual(loaded.fallbackReasons, []);
    }
    const cases = [];
    for (const entry of golden.cases) {
      await Promise.all(pages.map(p => p.evaluate(() => window.engine.reset())));
      const heartbeatBefore = await pages[0].evaluate(() => window.heartbeat);
      let position = 0, next = 0, activationError = 0, logitError = 0;
      const samples = new Map(entry.samples.map(s => [s.position, s]));
      const exchange = async byte => {
        const p = position++, sample = samples.get(p);
        const a = await pages[0].evaluate(([value, pos]) => window.engine.byte(value, pos), [byte, p]);
        assert.equal(a.bytes.length, 1536);
        if (sample) {
          const view = new DataView(Uint8Array.from(a.bytes).buffer);
          activationError = Math.max(activationError, check(Array.from({ length: 384 }, (_, i) => view.getFloat32(i * 4, true)), sample.phone1_activation));
        }
        const b = await pages[1].evaluate(([values, pos, debug]) => window.engine.activation(values, pos, debug), [a.bytes, p, !!sample]);
        if (sample) { logitError = Math.max(logitError, check(b.logits, sample.logits)); assert.equal(b.byte, sample.greedy_byte); }
        assert.ok(a.computeMs >= 0 && b.computeMs >= 0);
        return b.byte;
      };
      for (const byte of entry.prompt_bytes) next = await exchange(byte);
      const generated = [next];
      while (generated.length < entry.max_new_bytes && position < 512) { next = await exchange(next); generated.push(next); }
      assert.deepEqual(generated, entry.generated_bytes);
      for (const page of pages) {
        const stats = await page.evaluate(() => window.engine.stats());
        assert.equal(stats.position, position); assert.equal(stats.layerEvaluations, position * 3);
        assert.deepEqual(stats.cacheLengths, [position, position, position]);
      }
      const ticks = await pages[0].evaluate(() => window.heartbeat) - heartbeatBefore;
      if (entry.name === 'maximum_context') assert.ok(ticks > 10, 'Main thread heartbeat must run while workers compute');
      cases.push({ case: entry.name, positions: position, maxAbsActivationError: activationError, maxAbsLogitError: logitError, generatedBytesMatch: true, mainThreadHeartbeatTicks: ticks });
    }
    const requests = assetRequests.slice(assetStart);
    assert.deepEqual(requests.filter(r => r.file.endsWith('.bin')), [{ role: 'phone1', file: 'phone1.bin' }, { role: 'phone2', file: 'phone2.bin' }]);
    assert.deepEqual(errors, []);
    report.backends.push({ backend, cases, assetRequests: requests, pageErrors: errors });
    console.log(`${backend}: all 7 golden cases passed in separate browser workers; role-only shard requests verified`);
    await Promise.all(contexts.map(c => c.close()));
  }
  await mkdir(new URL('artifacts/reports/', root), { recursive: true });
  await writeFile(new URL('artifacts/reports/milestone2-browser.json', root), JSON.stringify(report, null, 2) + '\n');
  console.log(`Chrome ${report.browser}: 21 browser golden runs passed`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
