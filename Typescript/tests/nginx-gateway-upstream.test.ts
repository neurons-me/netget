import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// (1) Where nginx sends the gateway's own API is configurable: the standalone
//     backend on :3000 by default, or the monad that mounts the gateway
//     (xConfig.gatewayUpstream, written by `netget gateway-adopt`).
// (2) A registered domain whose wildcard is registered too (cleaker.me and
//     *.cleaker.me) answers both in one server block, so www.cleaker.me and
//     ana.cleaker.me reach the same surface instead of the default server.
//
// Disposable: temp data dir, temp fake "letsencrypt" dir. Nothing real is read.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-nginx-upstream-'));
const dataDir = path.join(tmp, 'data');
const liveDir = path.join(tmp, 'live');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = liveDir;
delete process.env.NETGET_GATEWAY_UPSTREAM;

for (const name of ['cleaker.me', 'example.org']) {
  fs.mkdirSync(path.join(liveDir, name), { recursive: true });
  fs.writeFileSync(path.join(liveDir, name, 'fullchain.pem'), 'fake');
  fs.writeFileSync(path.join(liveDir, name, 'privkey.pem'), 'fake');
}
fs.writeFileSync(
  path.join(dataDir, 'runtime', 'domain-map.json'),
  JSON.stringify({ version: 1, domains: { 'cleaker.me': {}, '*.cleaker.me': {}, 'example.org': {} } }),
);

const { getNetgetAppConfContent, resolveGatewayUpstream, serverNamesFor } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

// the pure pieces
assert.equal(resolveGatewayUpstream({}), 'http://127.0.0.1:3000');
assert.equal(resolveGatewayUpstream({ gatewayUpstream: 'http://127.0.0.1:8161/' }), 'http://127.0.0.1:8161');
assert.equal(resolveGatewayUpstream({ gatewayUpstream: 'http://localhost:8161' }), 'http://localhost:8161');
// an upstream can only be a port on this machine: it lands in a proxy_pass
assert.equal(resolveGatewayUpstream({ gatewayUpstream: 'http://evil.example:80' }), 'http://127.0.0.1:3000');
assert.equal(resolveGatewayUpstream({ gatewayUpstream: 'https://127.0.0.1:8161' }), 'http://127.0.0.1:3000');
assert.equal(resolveGatewayUpstream({ gatewayUpstream: 'http://127.0.0.1:8161/x; return 200' }), 'http://127.0.0.1:3000');
assert.equal(serverNamesFor('cleaker.me', new Set(['cleaker.me', '*.cleaker.me'])), 'cleaker.me *.cleaker.me');
assert.equal(serverNamesFor('example.org', new Set(['example.org'])), 'example.org');

// default: the standalone backend
const standalone = getNetgetAppConfContent();
assert.match(standalone, /proxy_pass http:\/\/127\.0\.0\.1:3000\/setup\/claim;/);
assert.doesNotMatch(standalone, /127\.0\.0\.1:8161/);

// the wildcard rides along with its domain, and only with it
assert.match(standalone, /server_name cleaker\.me \*\.cleaker\.me;/);
assert.match(standalone, /server_name example\.org;/);
assert.doesNotMatch(standalone, /server_name \*\.cleaker\.me;/);

// adopted by a monad: every gateway location goes to that monad
fs.writeFileSync(path.join(dataDir, 'xConfig.json'), JSON.stringify({ gatewayUpstream: 'http://127.0.0.1:8161' }));
const adopted = getNetgetAppConfContent();
assert.doesNotMatch(adopted, /127\.0\.0\.1:3000/, 'no location may still point at the standalone backend');
for (const route of ['/setup/claim', '/setup/verify-code', '/admin-session/verify', '/add-domain', '/provision-cert', '/main-server-namespace', '/gateway-identity']) {
  assert.match(adopted, new RegExp(`proxy_pass http://127\\.0\\.0\\.1:8161${route.replace(/[/-]/g, '\\$&')};`), route);
}

// /gateway-identity has ONE implementation: the gateway's route. There is no second answer behind nginx (a Lua handler that
// reported a different contract), in any configuration, and the port the request arrived on is passed along.
for (const [name, conf] of [['standalone', standalone], ['adopted', adopted]] as const) {
  assert.doesNotMatch(conf, /gateway_identity\.lua/, `${name}: no Lua handler answers /gateway-identity`);
  // the block of THIS location only (up to its own closing brace), so a header of another location cannot satisfy it
  const block = conf.match(/location = \/gateway-identity \{[\s\S]*?\n    \}\n/)?.[0];
  assert.ok(block, `${name}: /gateway-identity has an exact-match location`);
  assert.match(block!, /proxy_set_header X-Forwarded-Port \$server_port;/, `${name}: the arrival port is forwarded`);
  assert.match(block!, /proxy_pass http:\/\/127\.0\.0\.1:\d+\/gateway-identity;/, `${name}: it is proxied, in this very location`);
}
assert.match(standalone, /proxy_pass http:\/\/127\.0\.0\.1:3000\/gateway-identity;/, 'standalone: to the standalone backend, which mounts the same route');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('nginx-gateway-upstream.test.ts: all assertions passed');
