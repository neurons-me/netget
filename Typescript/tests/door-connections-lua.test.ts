import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// lua/lib/door_connections.lua and its use in surface_proxy.lua (the host door). The rules are the ones of
// src/runtime/doorConnections.ts, applied again at request time because domain-map.json is a file, not an authority.
// The /apps/<name>/ door (monad_proxy.lua) is covered by door-connections-openresty.test.ts, against a real nginx.
const resty = ['/usr/local/openresty/bin/resty', '/opt/homebrew/bin/resty', '/usr/local/bin/resty'].find((p) => fs.existsSync(p));
if (!resty) {
  console.log('door-connections-lua: skipped (no resty on this machine)');
  process.exit(0);
}
const luaRoot = path.resolve('src/modules/NetGetX/OpenResty/lua');
const handler = path.join(luaRoot, 'handlers/surface_proxy.lua');
const harness = path.resolve('tests/lua/surface_proxy_harness.lua');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-'));

// ---- the library, directly ------------------------------------------------------------------------------------
const libScript = path.join(tmp, 'lib.lua');
fs.writeFileSync(libScript, `
package.path = ${JSON.stringify(luaRoot)} .. "/?.lua;" .. package.path
local cjson = require "cjson.safe"
local dc = require "lib.door_connections"
local out = {}
local function put(k, v) out[k] = v end
local conns = {
  { prefix = "/api/fuel", target = "127.0.0.1:4000" },
  { prefix = "/api/fuel/stats", target = "127.0.0.1:4001" },
  { prefix = "/uploads", target = "localhost:4000" },
}
local registry = { apps = { a = { port = 4100, metadata = { endpoint = "http://127.0.0.1:4100", directEndpoint = "http://127.0.0.1:4100" } },
                              n = { port = 8161, metadata = { endpoint = "http://127.0.0.1:8161" } } } }
put("exact", dc.decide(conns, "/api/fuel", registry))
put("child", dc.decide(conns, "/api/fuel/1", registry))
put("longest", dc.decide(conns, "/api/fuel/stats/today", registry))
put("boundary", dc.decide(conns, "/api/fuelAnything", registry) == nil)
put("parent", dc.decide(conns, "/api", registry) == nil)
put("monad_keeps_v1", dc.decide(conns, "/api/v1/keychain/keys", registry) == nil)
put("localhost_normalized", dc.decide(conns, "/uploads/x.png", registry))
local function why(c) local r = dc.decide({ c }, c.prefix, registry); return r and r.error end
put("not_loopback", why({ prefix = "/x", target = "10.0.0.5:4000" }))
put("hostname", why({ prefix = "/x", target = "evil.example:4000" }))
put("gateway_port", why({ prefix = "/x", target = "127.0.0.1:3000" }))
put("nginx_port", why({ prefix = "/x", target = "127.0.0.1:443" }))
put("registered_monad", why({ prefix = "/x", target = "127.0.0.1:4100" }))
put("registered_by_endpoint", why({ prefix = "/x", target = "127.0.0.1:8161" }))
put("reserved", why({ prefix = "/api/v1/x", target = "127.0.0.1:4000" }))
put("covers_reserved", why({ prefix = "/api", target = "127.0.0.1:4000" }))
put("dotdot", why({ prefix = "/a/../b", target = "127.0.0.1:4000" }))
put("path_in_target", why({ prefix = "/x", target = "127.0.0.1:4000/admin" }))
put("userinfo", why({ prefix = "/x", target = "u@127.0.0.1:4000" }))
local map = { domains = {
  ["fulltrailer.suis.local"] = { type = "server", target = "app:fulltrailer", connections = conns },
  ["other.suis.local"] = { type = "server", target = "app:polls-studio", connections = { { prefix = "/api/meta", target = "127.0.0.1:9004" } } },
} }
put("for_app", #dc.for_app(map, "fulltrailer"))
put("for_app_other", dc.for_app(map, "polls-studio")[1].prefix)
put("for_app_none", #dc.for_app(map, "nobody"))
print(cjson.encode(out))
`);
const lib = spawnSync(resty, [libScript], { encoding: 'utf8' });
assert.equal(lib.status, 0, lib.stderr);
const L = JSON.parse(lib.stdout.trim().split('\n').pop() as string);
assert.deepEqual(L.exact, { upstream: 'http://127.0.0.1:4000', prefix: '/api/fuel' });
assert.deepEqual(L.child, { upstream: 'http://127.0.0.1:4000', prefix: '/api/fuel' });
assert.deepEqual(L.longest, { upstream: 'http://127.0.0.1:4001', prefix: '/api/fuel/stats' }, 'longest prefix');
assert.equal(L.boundary, true, '/api/fuelAnything is not /api/fuel');
assert.equal(L.parent, true, '/api is not under /api/fuel');
assert.equal(L.monad_keeps_v1, true, '/api/v1/* stays with the monad');
assert.deepEqual(L.localhost_normalized, { upstream: 'http://127.0.0.1:4000', prefix: '/uploads' }, 'localhost means the literal');
for (const [key, re] of Object.entries({
  not_loopback: /loopback/, hostname: /loopback/, gateway_port: /gateway/, nginx_port: /port range|gateway/,
  registered_monad: /registered monad/, registered_by_endpoint: /registered monad/, reserved: /overlaps/, covers_reserved: /overlaps/,
  dotdot: /dot segment|prefix/, path_in_target: /target shape/, userinfo: /target shape/,
}) as [string, RegExp][]) {
  assert.match(String(L[key]), re, `${key}: ${L[key]}`);
}
assert.equal(L.for_app, 3);
assert.equal(L.for_app_other, '/api/meta');
assert.equal(L.for_app_none, 0);

// ---- the host door: surface_proxy.lua ---------------------------------------------------------------------------
const ROOT = 'suis-macbook-air.local';
const FT_HOST = `fulltrailer.${ROOT}`;
const apps = [{
  name: 'monad:fulltrailer', host: '127.0.0.1', port: 4100, ttlMs: 12000, lastSeenMs: 1_999_000, trust: 'peer',
  metadata: { monadName: 'fulltrailer', namespace: FT_HOST, identity: FT_HOST, identity_hash: 'ft-identity',
    endpoint: 'http://127.0.0.1:4100', directEndpoint: 'http://127.0.0.1:4100', claimed_namespaces: [FT_HOST] },
}];
function door(uri: string, connections: unknown, extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: { id0: apps[0] } }));
  fs.writeFileSync(path.join(dir, 'runtime', 'domain-map.json'), JSON.stringify({
    version: 1, domains: { [FT_HOST]: { type: 'server', target: 'app:fulltrailer', ssl: { enabled: false }, connections, ...extra } },
  }));
  const r = spawnSync(resty, [harness, handler, dir, FT_HOST, 'text/html'], { env: { ...process.env, NETGET_DATA_DIR: dir, HARNESS_URI: uri }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop() as string) as { exit?: number; exec?: string; target: string; identity: string; connection_target: string; connection_prefix: string; reason?: string; status?: number };
}
const conns = [{ prefix: '/api/fuel', target: '127.0.0.1:4000' }, { prefix: '/api/upload', target: '127.0.0.1:4000' }, { prefix: '/uploads', target: '127.0.0.1:4000' }];

// a matching path goes to the connection (exec to the named location), not to the monad
const fuel = door('/api/fuel', conns);
assert.equal(fuel.exec, '@door_connection');
assert.equal(fuel.connection_target, 'http://127.0.0.1:4000');
assert.equal(fuel.connection_prefix, '/api/fuel');
assert.equal(fuel.target, '', 'the monad was not selected');
assert.equal(door('/api/fuel/2024', conns).exec, '@door_connection', 'a descendant');
assert.equal(door('/uploads/a.png', conns).exec, '@door_connection');

// everything else keeps going to the monad of the door
for (const uri of ['/', '/api/v1/keychain/keys', '/api/fuelAnything', '/api', '/claims/signIn', '/operadores']) {
  const r = door(uri, conns);
  assert.equal(r.exec, undefined, `${uri} is not carved out`);
  assert.equal(r.target, 'http://127.0.0.1:4100', `${uri} -> the monad`);
  assert.equal(r.identity, 'ft-identity');
}

// a declared connection that is not allowed is an error, never the monad (which would answer an API call with a page)
for (const bad of [
  [{ prefix: '/api/fuel', target: '10.0.0.5:4000' }],
  [{ prefix: '/api/fuel', target: '127.0.0.1:3000' }],
  [{ prefix: '/api/fuel', target: '127.0.0.1:4100' }],   // the registered monad's own port
  [{ prefix: '/api/fuel', target: '127.0.0.1:4000/admin' }],
]) {
  const r = door('/api/fuel', bad);
  assert.equal(r.exit, 502, `refused target answers 502: ${JSON.stringify(bad)}`);
  assert.equal(r.exec, undefined);
  assert.equal(r.target, '', 'did not fall to the monad');
  assert.equal(r.reason, 'connection_not_applied');
}
// ...but a path the bad connection does not match is unaffected
assert.equal(door('/operadores', [{ prefix: '/api/fuel', target: '10.0.0.5:4000' }]).target, 'http://127.0.0.1:4100');

// no connections: the door behaves as before
assert.equal(door('/api/fuel', undefined).target, 'http://127.0.0.1:4100');
assert.equal(door('/api/fuel', []).target, 'http://127.0.0.1:4100');

console.log('door-connections-lua: ok');
