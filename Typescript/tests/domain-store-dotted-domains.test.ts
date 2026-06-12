import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const { getDomains, getDomainByName, registerDomain } = await import('../src/kernel/domainStore.ts');

await registerDomain(
    'netget.site',
    'netget.site',
    'admin@neurons.me',
    'letsencrypt',
    '/etc/letsencrypt/live/netget.site/fullchain.pem',
    '/etc/letsencrypt/live/netget.site/privkey.pem',
    '3432',
    'server',
    '',
    'main-server'
);

const byName = await getDomainByName('netget.site');
assert.equal(byName?.domain, 'netget.site');
assert.equal(byName?.type, 'server');
assert.equal(byName?.owner, 'main-server');

const domains = await getDomains();
assert.equal(domains.length, 1);
assert.equal(domains[0]?.domain, 'netget.site');
assert.equal(domains[0]?.sslCertificate, '/etc/letsencrypt/live/netget.site/fullchain.pem');
assert.equal(domains[0]?.sslCertificateKey, '/etc/letsencrypt/live/netget.site/privkey.pem');

console.log('domain-store-dotted-domains ok');
