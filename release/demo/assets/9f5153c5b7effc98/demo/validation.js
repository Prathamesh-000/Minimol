export const scenarios = {
    iosQR: 'On an actual iPhone Safari, grant camera permission and reconstruct every offer/answer chunk.',
    androidQR: 'On actual Android Chrome, grant camera permission and reconstruct every offer/answer chunk.',
    qrAssembly: 'Reordered/duplicate chunks reconstruct one message; mixed exchanges are rejected.',
    qrValidation: 'Malformed, expired, wrong-role and checksum-invalid messages are rejected.',
    download: 'An interrupted download is not committed; retry verifies the assigned shard.',
    corruptCache: 'Corrupted cached bytes are rejected/deleted and online retry repairs the shard.',
    offlineReload: 'Reload shell and assigned verified shard without HTTP access while retaining local Wi-Fi.',
    pairedReload: 'Reload invalidates the old connection; fresh pairing restores inference.',
    screenResume: 'After screen lock/resume, show current state and require fresh pairing if disconnected.',
    reconnect: 'Disconnect during generation rejects pending work; a fresh pair produces canonical bytes.'
};
export class ValidationLog {
    rows = Object.entries(scenarios).map(([name, expected]) => ({ name, expected, status: 'NOT TESTED', detail: '', time: '' }));
    events = [];
    observe(name, detail) {
        this.events.push({ time: new Date().toISOString(), name, detail });
        if (this.events.length > 100)
            this.events.shift();
    }
    record(name, status, detail) {
        const row = this.rows.find(r => r.name === name);
        if (!row || !['PASS', 'FAIL', 'NOT TESTED'].includes(status))
            throw new Error('Invalid validation result');
        if (status !== 'NOT TESTED' && !detail.trim())
            throw new Error('Record actual observations before marking PASS/FAIL');
        Object.assign(row, { status, detail, time: new Date().toISOString() });
    }
}
