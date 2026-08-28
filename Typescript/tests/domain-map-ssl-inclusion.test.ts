import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers generateDomainMap()'s inclusion/exclusion rules — the mechanism
// that silently dropped netget.site from domain-map.json in production
// because it had no route `type` set yet (SSL was already configured, but
// that alone isn't enough: a domain "can live in the registry without being
// active in the Routing table", and generateDomainMap() skips it entirely
// in that case with no warning).
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `domain-map-ssl-test-${process.pid}.local`;

const noRouteDomain = `no-route-${process.pid}.example`;
const halfCertDomain = `half-cert-${process.pid}.example`;
const readyDomain = `ready-${process.pid}.example`;

const { registerDomain, updateDomainType, updateDomainTarget } = await import('../src/kernel/domainStore.ts');
const { generateDomainMap, getDomainMapPath } = await import('../src/runtime/domainMap.ts');

// 1) Registered, SSL fully configured, but no route type -> must be excluded.
await registerDomain(
    noRouteDomain, noRouteDomain, 'admin@neurons.me', 'letsencrypt',
    `/etc/letsencrypt/live/${noRouteDomain}/fullchain.pem`,
    `/etc/letsencrypt/live/${noRouteDomain}/privkey.pem`,
    '', '', '', 'test-owner',
);

// 2) Registered with a route type but only a cert path, no key -> included,
//    but ssl.enabled must be false (never present a half-configured cert).
await registerDomain(
    halfCertDomain, halfCertDomain, 'admin@neurons.me', 'letsencrypt',
    `/etc/letsencrypt/live/${halfCertDomain}/fullchain.pem`, '',
    '127.0.0.1:9000', 'server', '', 'test-owner',
);

// 3) Fully configured: route + both cert paths -> included with ssl.enabled true.
await registerDomain(
    readyDomain, readyDomain, 'admin@neurons.me', 'letsencrypt',
    `/etc/letsencrypt/live/${readyDomain}/fullchain.pem`,
    `/etc/letsencrypt/live/${readyDomain}/privkey.pem`,
    '127.0.0.1:9001', 'server', '', 'test-owner',
);

await generateDomainMap();
const map = JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8'));

assert.equal(map.domains[noRouteDomain], undefined, 'a domain with no route type must not appear in domain-map.json at all');

assert.ok(map.domains[halfCertDomain], 'a routed domain must appear even with an incomplete cert');
assert.equal(map.domains[halfCertDomain].ssl.enabled, false, 'ssl.enabled must be false when only one of cert/key is set');

assert.ok(map.domains[readyDomain]);
assert.equal(map.domains[readyDomain].ssl.enabled, true);
assert.equal(map.domains[readyDomain].ssl.cert, `/etc/letsencrypt/live/${readyDomain}/fullchain.pem`);
assert.equal(map.domains[readyDomain].ssl.key, `/etc/letsencrypt/live/${readyDomain}/privkey.pem`);
assert.equal(map.domains[readyDomain].target, '127.0.0.1:9001');

console.log('domain-map-ssl-inclusion ok');
