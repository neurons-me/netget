import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
const tmpLeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-le-'));

const runtimeDir = path.join(tmpDataDir, 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });

const domainMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    node: { hostname: 'test-host' },
    domains: {
        'netget.site': { type: 'proxy', target: 'http://127.0.0.1:3000', protocol: 'http', ssl: { enabled: false } },
        'no-cert.example': { type: 'proxy', target: 'http://127.0.0.1:3001', protocol: 'http', ssl: { enabled: false } },
        'static.example': { type: 'static', root: '/srv/sites/static.example', ssl: { enabled: true } },
    },
};
fs.writeFileSync(path.join(runtimeDir, 'domain-map.json'), JSON.stringify(domainMap, null, 2), 'utf8');

// Only "netget.site" gets a real cert dir; "no-cert.example" does not.
const certDir = path.join(tmpLeDir, 'netget.site');
fs.mkdirSync(certDir, { recursive: true });
fs.writeFileSync(path.join(certDir, 'fullchain.pem'), 'fake-fullchain', 'utf8');
fs.writeFileSync(path.join(certDir, 'privkey.pem'), 'fake-privkey', 'utf8');
// "static.example" has a cert too, but it is a static folder: the default server serves it, not a block of its own.
const staticCertDir = path.join(tmpLeDir, 'static.example');
fs.mkdirSync(staticCertDir, { recursive: true });
fs.writeFileSync(path.join(staticCertDir, 'fullchain.pem'), 'fake-fullchain', 'utf8');
fs.writeFileSync(path.join(staticCertDir, 'privkey.pem'), 'fake-privkey', 'utf8');

process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = tmpLeDir;

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

const conf = getNetgetAppConfContent();

// Domain with a Let's Encrypt cert present must get its own server block.
assert.match(conf, /server_name netget\.site;/);
assert.match(conf, new RegExp(`ssl_certificate\\s+${path.join(certDir, 'fullchain.pem').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
assert.match(conf, new RegExp(`ssl_certificate_key\\s+${path.join(certDir, 'privkey.pem').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));

// Domain without a cert dir must NOT get a server block.
assert.doesNotMatch(conf, /server_name no-cert\.example;/);

// A static domain with a cert must NOT get a block that proxies it to surface_proxy.lua.
assert.doesNotMatch(conf, /server_name static\.example;/);

console.log('public-domain-ssl ok');
