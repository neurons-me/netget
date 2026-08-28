import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `domain-store-test-${process.pid}.local`;
const netgetDomain = `netget-${process.pid}.site`;
const fulltrailerDomain = `fulltrailer-${process.pid}.com.mx`;

const {
    getDomains,
    getDomainByName,
    registerDomain,
    updateSSLCertificatePaths,
} = await import('../src/kernel/domainStore.ts');
const { generateDomainMap, getDomainMapPath } = await import('../src/runtime/domainMap.ts');

await registerDomain(
    netgetDomain,
    netgetDomain,
    'admin@neurons.me',
    'letsencrypt',
    '/etc/letsencrypt/live/netget.site/fullchain.pem',
    '/etc/letsencrypt/live/netget.site/privkey.pem',
    '3432',
    'server',
    '',
    'main-server'
);

const byName = await getDomainByName(netgetDomain);
assert.equal(byName?.domain, netgetDomain);
assert.equal(byName?.type, 'server');
assert.equal(byName?.owner, 'main-server');

await registerDomain(
    fulltrailerDomain,
    '',
    'admin@neurons.me',
    'none',
    '',
    '',
    '',
    'proxy',
    '',
    'semantic-surface'
);

await updateSSLCertificatePaths(
    fulltrailerDomain,
    '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem',
    '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem'
);

const domains = await getDomains();
assert.ok(domains.length >= 2);

const netgetSite = domains.find((domain) => domain.domain === netgetDomain);
assert.equal(netgetSite?.sslCertificate, '/etc/letsencrypt/live/netget.site/fullchain.pem');
assert.equal(netgetSite?.sslCertificateKey, '/etc/letsencrypt/live/netget.site/privkey.pem');

const fulltrailer = domains.find((domain) => domain.domain === fulltrailerDomain);
assert.equal(fulltrailer?.target || '', '');
assert.equal(fulltrailer?.type, 'proxy');
assert.equal(fulltrailer?.sslMode, 'letsencrypt');
assert.equal(fulltrailer?.sslCertificate, '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem');
assert.equal(fulltrailer?.sslCertificateKey, '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem');

await generateDomainMap();
const domainMap = JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8'));
assert.deepEqual(domainMap.domains[fulltrailerDomain], {
    type: 'proxy',
    protocol: 'http',
    ssl: {
        enabled: true,
        cert: '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem',
        key: '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem',
    },
});

console.log('domain-store-dotted-domains ok');
