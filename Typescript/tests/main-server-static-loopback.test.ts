import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers the "main-server domain is a static loopback" behavior: whatever
// domain an operator sets via Main Server -> Set public domain must be
// served directly from netget's own static build (${xConfig}/html) in the
// 443 ssl server block, entirely bypassing domain-map routing and any proxy
// to a monad — the public counterpart of local.netget/localhost/127.0.0.1.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
fs.writeFileSync(path.join(tmpDataDir, 'xConfig.json'), JSON.stringify({ mainServerName: 'netget.site' }), 'utf8');

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const conf = buildNginxConfigContent();

// The check must run before _G.DOMAIN_MAP is even consulted, so the
// main-server domain never depends on domain-map.json having an entry
// (let alone a working proxy target) for it.
// "local map = _G.DOMAIN_MAP" also appears in ssl_certificate_by_lua_block
// (SNI cert selection) — anchor on the HTTP_SERVICE_UNAVAILABLE fallback
// that's unique to the location / handler this check must precede.
const mainServerCheckIndex = conf.indexOf('host == _G.MAIN_SERVER_NAME');
const domainMapCheckIndex = conf.indexOf('ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)');
assert.ok(mainServerCheckIndex > -1, 'main-server static-loopback check must be present');
assert.ok(domainMapCheckIndex > -1, 'domain-map lookup must still exist for every other domain');
assert.ok(mainServerCheckIndex < domainMapCheckIndex, 'main-server check must run before domain-map is consulted');

// It serves the same static root netget's own html gateway uses, via the
// same @dynamic_root mechanism as a type:'static' domain-map route — no
// bespoke serving logic, no proxy_pass.
assert.match(conf, /ngx\.var\.root = "[^"]+\/html"\s*\n\s*ngx\.exec\("@dynamic_root"\)/);

console.log('main-server-static-loopback ok');
