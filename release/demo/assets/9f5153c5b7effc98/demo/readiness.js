import { ValidationLog, scenarios } from './validation.js';
export function setupReadiness(session) {
    const log = new ValidationLog();
    const $ = (id) => document.getElementById(id);
    const select = $('validation-test');
    for (const [name, expected] of Object.entries(scenarios)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.append(option);
    }
    const render = () => { $('validation-expected').textContent = scenarios[select.value]; $('validation-results').textContent = JSON.stringify({ tests: log.rows, observedEvents: log.events }, null, 2); };
    select.onchange = render;
    render();
    const environment = () => ({ browser: navigator.userAgent, platform: navigator.platform, languages: navigator.languages, screen: { width: screen.width, height: screen.height }, visibility: document.visibilityState, online: navigator.onLine, build: $('build').textContent, secureContext: isSecureContext, operatorClassification: $('device-class').value });
    let lastBenchmark, loadMs;
    const evidence = () => ({ environment: environment(), tests: log.rows, events: log.events, loadMs, lastBenchmark, connection: session()?.pairing.status, jsHeap: performance.memory?.usedJSHeapSize ?? null, memoryNote: 'JS heap where exposed only; not total phone RAM', collectedAt: new Date().toISOString() });
    $('validation-record').onclick = () => { try {
        log.record(select.value, $('validation-status').value, $('validation-note').value);
        render();
    }
    catch (e) {
        $('last-error').textContent = e.message;
    } };
    $('validation-export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(evidence(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'minimol-device-evidence.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    let previous = '';
    for (const id of ['status', 'qr-status', 'offline-state', 'd-shard'])
        new MutationObserver(() => {
            const detail = $(id).textContent ?? '';
            if (detail === previous)
                return;
            previous = detail;
            log.observe(id, detail);
            if (/error|fail|denied|unavailable|damaged|disconnected|timed out|mismatch/i.test(detail))
                $('last-error').textContent = detail;
            render();
        }).observe($(id), { childList: true, subtree: true, characterData: true });
    try {
        if (sessionStorage.getItem('minimol-paired') === 'yes')
            log.observe('pairedReload', 'Previous page was paired. New page requires a fresh offer/answer; old KV session is not resumed.');
    }
    catch { }
    render();
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) {
        hiddenAt = Date.now();
        log.observe('screenResume', 'Page became hidden; screen lock cannot be distinguished from tab switching.');
    }
    else {
        log.observe('screenResume', `Page visible after ${hiddenAt ? Date.now() - hiddenAt : 0} ms. Inspect live connection; retry pairing if closed.`);
    } render(); });
    window.addEventListener('pagehide', () => { try {
        sessionStorage.setItem('minimol-paired', session()?.isReady ? 'yes' : 'no');
    }
    catch { } });
    let polling = false;
    setInterval(async () => { const s = session(); if (!s)
        return; const p = s.pairing.status; $('peer-state').textContent = p.connection; $('channel-state').textContent = p.channel; if (!s.isReady) {
        $('participation').textContent = 'Waiting for verified peer / fresh pairing';
        return;
    } if (polling)
        return; polling = true; try {
        const stats = await s.call('stats');
        if (session() !== s)
            return;
        const trace = stats.trace;
        const valid = trace.length > 0 && trace.every((t) => t.layerEvaluations === 3 && JSON.stringify(t.layerIds) === JSON.stringify(s.role === 'phone1' ? [0, 1, 2] : [3, 4, 5]));
        $('participation').textContent = valid ? (s.role === 'phone1' ? `${trace.length} completed two-runtime exchanges` : `${trace.length} worker positions from peer activations`) : 'Handshake verified; awaiting inference';
    }
    catch { }
    finally {
        polling = false;
    } }, 1000);
    $('run-benchmark').onclick = async () => {
        const s = session();
        if (!s?.isReady || s.role !== 'phone1') {
            $('last-error').textContent = 'Pair both phones, then run benchmark on Phone 1.';
            return;
        }
        const button = $('run-benchmark');
        button.disabled = true;
        $('generate').disabled = true;
        try {
            const warmups = 2, runs = 5, samples = [];
            for (let i = 0; i < warmups + runs; i++) {
                window.resetGenerationView();
                const r = await s.generate('Hello', 8);
                window.finishGenerationView();
                if (JSON.stringify([...r.generated]) !== '[63,119,179,184,253,37,243,172]')
                    throw new Error('Benchmark output differs from canonical reference');
                if (i >= warmups)
                    samples.push(r.benchmark);
                $('benchmark-result').textContent = `Run ${i + 1}/${warmups + runs}`;
            }
            lastBenchmark = { ...environment(), warmups, runs, prompt: 'Hello', newBytes: 8, samples };
            $('benchmark-result').textContent = JSON.stringify(lastBenchmark, null, 2);
            log.observe('benchmark', 'Five real DataChannel runs completed; all canonical bytes matched.');
            render();
        }
        catch (e) {
            $('last-error').textContent = e.message;
        }
        finally {
            button.disabled = false;
            if (session() === s) {
                window.finishGenerationView();
                $('generate').disabled = !s.isReady;
            }
        }
    };
    return { loaded(model) { loadMs = model.loadMs; $('backend').textContent = model.backend; log.observe('modelLoad', `Verified ${model.role}; load ${model.loadMs.toFixed(2)} ms; cached=${model.cached}`); render(); } };
}
