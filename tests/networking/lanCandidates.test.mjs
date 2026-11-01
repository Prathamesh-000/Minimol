import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateSummary, validateLanIPv4, withLanAddress } from '../../dist/networking/lanCandidates.js';

const sdp = 'v=0\r\na=ice-ufrag:keep\r\na=ice-pwd:keep-password\r\na=fingerprint:sha-256 KEEP\r\n' +
  'a=candidate:123 1 udp 2113937151 unique.local 49495 typ host generation 0 network-cost 999\r\n' +
  'a=candidate:456 1 udp 2113937151 192.168.1.4 1234 typ host\r\n' +
  'a=candidate:789 1 udp 2113937151 fd00::1 2345 typ host\r\n';

test('explicit Wi-Fi address changes only exported mDNS UDP addresses, retaining actual ICE port and credentials', () => {
  const result = withLanAddress(sdp, ' 10.10.222.230 ');
  assert.equal(result, sdp.replace('unique.local', '10.10.222.230'));
  assert.deepEqual(candidateSummary(result), { total: 3, mdns: 0, ipv4: 2, ipv6: 1 });
  assert.deepEqual(candidateSummary(sdp), { total: 3, mdns: 1, ipv4: 1, ipv6: 1 });
  assert.equal(withLanAddress(sdp), sdp);
  assert.equal(withLanAddress(sdp, '  '), sdp);
});

test('Wi-Fi IP entry rejects public, loopback, multicast, malformed and injection values', () => {
  for (const value of ['10.0.0.1', '172.16.1.1', '172.31.255.254', '192.168.0.1']) assert.equal(validateLanIPv4(value), value);
  for (const value of ['', '127.0.0.1', '8.8.8.8', '0.0.0.0', '224.0.0.1', '172.32.0.1', '172.15.0.1', '192.168.1.256', '10.01.1.1', '10.1.1', '10.1.1.1\r\na=candidate:bad', '::1', 'example.local']) {
    assert.throws(() => validateLanIPv4(value));
  }
});

test('address workaround never rewrites relay/reflexive/TCP candidates or unrelated SDP fields', () => {
  for (const value of [sdp.replace('typ host', 'typ relay'), sdp.replace('typ host', 'typ srflx'), sdp.replace('1 udp', '1 tcp')]) {
    assert.equal(withLanAddress(value, '10.0.0.1'), value);
  }
});
