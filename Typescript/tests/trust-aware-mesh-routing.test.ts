import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifies the trust-aware mesh reduction wiring:
//   - surface_proxy.lua ranks candidates by trust tier before recency, and
//     exposes the winning identity_hash via ngx.var.surface_proxy_identity
//   - every mesh-routed server block (bare hostname, NRP handle, and
//     non-main-server public domains) declares that var and forwards it as
//     the X-NetGet-Identity response header

const surfaceProxyPath = fileURLToPath(
    new URL('../src/modules/NetGetX/OpenResty/lua/handlers/surface_proxy.lua', import.meta.url)
);
const lua = fs.readFileSync(surfaceProxyPath, 'utf8');

assert.match(lua, /local TRUST_RANK = \{ owner = 4, admin = 3, peer = 2, guest = 1 \}/);
assert.match(lua, /trust = app\.trust/);
assert.match(lua, /identity = meta\.identity_hash or meta\.identityHash/);

// Reduction must compare trust rank before it ever compares lastSeen.
const trustRankIndex = lua.indexOf('local bestRank = TRUST_RANK[best.trust]');
const lastSeenCompareIndex = lua.indexOf('c.lastSeen > best.lastSeen');
assert.ok(trustRankIndex !== -1, 'reduction must rank by TRUST_RANK');
assert.ok(lastSeenCompareIndex !== -1, 'reduction must still use lastSeen as a tiebreaker');
assert.ok(trustRankIndex < lastSeenCompareIndex, 'trust rank must be established before the lastSeen tiebreaker');

assert.match(lua, /ngx\.var\.surface_proxy_identity = best\.identity or ""/);
assert.match(lua, /ambiguous claim for host/);

// --- Generated config: mesh blocks declare + forward the identity var ---

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
const tmpLeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-le-'));
const publicDomain = 'mesh.example';

fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });
fs.writeFileSync(
    path.join(tmpDataDir, 'xConfig.json'),
    JSON.stringify({ mainServerFrontendMode: 'package-dist' }, null, 2),
    'utf8'
);
fs.writeFileSync(
    path.join(tmpDataDir, 'runtime', 'domain-map.json'),
    JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        node: { hostname: 'test-host' },
        domains: {
            [publicDomain]: { type: 'proxy', target: 'http://127.0.0.1:3000', protocol: 'http', ssl: { enabled: true } },
        },
    }, null, 2),
    'utf8'
);
const certDir = path.join(tmpLeDir, publicDomain);
fs.mkdirSync(certDir, { recursive: true });
fs.writeFileSync(path.join(certDir, 'fullchain.pem'), 'fake-fullchain', 'utf8');
fs.writeFileSync(path.join(certDir, 'privkey.pem'), 'fake-privkey', 'utf8');

process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = tmpLeDir;

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
const conf = getNetgetAppConfContent();

const varCount = (conf.match(/set \$surface_proxy_identity "";/g) || []).length;
const headerCount = (conf.match(/add_header X-NetGet-Identity \$surface_proxy_identity always;/g) || []).length;

// Bare hostname block + NRP handle block + this one public (non-main) domain block = 3.
assert.equal(varCount, 3, `expected 3 mesh blocks to declare surface_proxy_identity, found ${varCount}`);
assert.equal(headerCount, 3, `expected 3 mesh blocks to forward X-NetGet-Identity, found ${headerCount}`);

console.log('trust-aware-mesh-routing.test.ts passed');
