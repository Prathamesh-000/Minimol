/** Optional, explicit local IPv4 workaround for networks that block mDNS. */
export function validateLanIPv4(value) {
    const ip = value.trim();
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) {
        throw new Error("Enter THIS phone's Wi-Fi IPv4 address, for example 10.10.222.230");
    }
    const [a, b] = parts.map(Number);
    if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
        throw new Error('Use a private Wi-Fi IPv4 address (10.x, 172.16–31.x, or 192.168.x)');
    }
    return ip;
}
export function candidateSummary(sdp = '') {
    const candidates = sdp.split('\r\n').filter(line => line.startsWith('a=candidate:')).map(line => line.split(/\s+/));
    return { total: candidates.length, mdns: candidates.filter(c => c[4]?.toLowerCase().endsWith('.local')).length,
        ipv4: candidates.filter(c => /^\d+\.\d+\.\d+\.\d+$/.test(c[4])).length,
        ipv6: candidates.filter(c => c[4]?.includes(':')).length };
}
/**
 * Change only the address in exported mDNS UDP host candidates. Keep the actual
 * browser-bound port, ICE credentials and DTLS fingerprint. The local description
 * stays untouched. The supplied address must belong to this phone's Wi-Fi interface;
 * it is not a server/relay address. ICE and DTLS still authenticate the real peer.
 */
export function withLanAddress(sdp, value = '') {
    if (!value.trim())
        return sdp;
    const ip = validateLanIPv4(value);
    return sdp.split('\r\n').map(line => {
        if (!line.startsWith('a=candidate:'))
            return line;
        const fields = line.split(/\s+/);
        if (fields[2]?.toLowerCase() === 'udp' && fields[6] === 'typ' && fields[7] === 'host'
            && fields[4]?.toLowerCase().endsWith('.local')) {
            fields[4] = ip;
            return fields.join(' ');
        }
        return line;
    }).join('\r\n');
}
