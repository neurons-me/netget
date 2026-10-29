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
const luaRoot = process.env.DOOR_LUA_ROOT ? path.resolve(process.env.DOOR_LUA_ROOT) : path.resolve('src/modules/NetGetX/OpenResty/lua');
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
local function authz(app, method) local ok, why = dc.authorization_allows(app, method); return { ok = ok, why = why } end
put("a_get_default", authz({}, "GET"))
put("a_head_default", authz({}, "HEAD"))
put("a_post_default", authz({}, "POST"))
put("a_post_lower", authz({}, "post"))
put("a_put_default", authz({}, "PUT"))
put("a_patch_default", authz({}, "PATCH"))
put("a_delete_default", authz({}, "DELETE"))
put("a_post_required", authz({ exposure = { auth = { requiredForDestructive = true } } }, "POST"))
put("a_post_declared_open", authz({ exposure = { auth = { requiredForDestructive = false } } }, "POST"))
put("a_get_read_required", authz({ exposure = { auth = { requiredForRead = true } } }, "GET"))
put("a_get_read_open", authz({ exposure = { auth = { requiredForRead = false, requiredForDestructive = true } } }, "GET"))
put("a_post_loopback_is_not_auth", authz({ exposure = { visibility = "loopback", network = { allowLoopback = true } } }, "POST"))
local function allowed(app, remote) local ok, status = dc.exposure_allows(app, remote); return { ok = ok, status = (not ok) and status or nil } end
put("x_default_loopback", allowed({}, "127.0.0.1"))
put("x_default_lan", allowed({}, "192.168.1.20"))
put("x_default_wan", allowed({}, "8.8.8.8"))
put("x_loopback_policy", allowed({ exposure = { visibility = "loopback", network = { allowLoopback = true } } }, "192.168.1.20"))
put("x_loopback_off", allowed({ exposure = { network = { allowLoopback = false } } }, "127.0.0.1"))
put("x_lan_ok", allowed({ exposure = { visibility = "lan", network = { allowLan = true } } }, "192.168.1.20"))
put("x_lan_wan_peer", allowed({ exposure = { visibility = "lan", network = { allowLan = true } } }, "8.8.8.8"))
put("x_lan_denied", allowed({ exposure = { visibility = "lan", network = { allowLan = false } } }, "10.0.0.7"))
put("x_wan_ok", allowed({ exposure = { visibility = "wan", network = { allowWan = true } } }, "8.8.8.8"))
put("x_wan_denied", allowed({ exposure = { visibility = "wan", network = { allowWan = false } } }, "8.8.8.8"))
put("x_disabled", allowed({ exposure = { enabled = false } }, "127.0.0.1"))
put("x_guest", allowed({ trust = "guest", exposure = { visibility = "wan", network = { allowWan = true } } }, "127.0.0.1"))
put("x_unknown_visibility", allowed({ exposure = { visibility = "everyone" } }, "8.8.8.8"))
put("x_app_default_loopback", allowed({ kind = "app", trust = "guest" }, "127.0.0.1"))
put("x_app_default_lan", allowed({ kind = "app", trust = "guest" }, "192.168.1.20"))
put("x_app_default_wan", allowed({ kind = "app", trust = "guest" }, "8.8.8.8"))
put("x_app_lan_policy", allowed({ kind = "app", trust = "guest", exposure = { visibility = "lan" } }, "192.168.1.20"))
put("x_app_lan_policy_wan_peer", allowed({ kind = "app", trust = "guest", exposure = { visibility = "lan" } }, "8.8.8.8"))
put("x_app_disabled", allowed({ kind = "app", trust = "guest", exposure = { enabled = false } }, "127.0.0.1"))
put("x_app_loopback_off", allowed({ kind = "app", trust = "guest", exposure = { network = { allowLoopback = false } } }, "127.0.0.1"))
put("x_monad_guest_wan", allowed({ kind = "monad", trust = "guest", exposure = { visibility = "wan" } }, "127.0.0.1"))
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
// what the app declared about authorization is a requirement of the operation; the gateway cannot check a session on a
// connection yet, so an operation that requires one is refused (not waved through because the peer is loopback)
assert.deepEqual(L.a_get_default, { ok: true });
assert.deepEqual(L.a_head_default, { ok: true });
for (const key of ['a_post_default', 'a_post_lower', 'a_put_default', 'a_patch_default', 'a_delete_default', 'a_post_required', 'a_post_loopback_is_not_auth']) {
  assert.deepEqual(L[key], { ok: false, why: 'authorization_required' }, `${key}: refused`);
}
assert.deepEqual(L.a_post_declared_open, { ok: true }, 'an app that explicitly declares destructive operations need no authorization');
assert.deepEqual(L.a_get_read_required, { ok: false, why: 'authorization_required' }, 'requiredForRead refuses a read');
assert.deepEqual(L.a_get_read_open, { ok: true });
// who may use a connection: the app's exposure policy, judged on the connecting address; no policy = loopback only
assert.deepEqual(L.x_default_loopback, { ok: true });
assert.deepEqual(L.x_default_lan, { ok: false, status: 403 }, 'an app with no policy is not served to the LAN');
assert.deepEqual(L.x_default_wan, { ok: false, status: 403 });
assert.deepEqual(L.x_loopback_policy, { ok: false, status: 403 }, 'visibility loopback refuses a LAN peer');
assert.deepEqual(L.x_loopback_off, { ok: false, status: 403 }, 'allowLoopback = false refuses even a loopback peer');
assert.deepEqual(L.x_lan_ok, { ok: true });
assert.deepEqual(L.x_lan_wan_peer, { ok: false, status: 403 }, 'visibility lan does not admit a public address');
assert.deepEqual(L.x_lan_denied, { ok: false, status: 403 });
assert.deepEqual(L.x_wan_ok, { ok: true });
assert.deepEqual(L.x_wan_denied, { ok: false, status: 403 });
assert.deepEqual(L.x_disabled, { ok: false, status: 404 }, 'a disabled app has no connections');
assert.deepEqual(L.x_guest, { ok: false, status: 403 }, 'a guest-trust app has no connections, whatever its policy says');
assert.deepEqual(L.x_unknown_visibility, { ok: false, status: 403 }, 'an unknown visibility fails closed');
// an APP entry is always "guest" (that is what an app is, not a verdict): it follows the policy it declared, and an app
// that declared nothing is loopback-only. A guest MONAD still has no connections.
assert.deepEqual(L.x_app_default_loopback, { ok: true });
assert.deepEqual(L.x_app_default_lan, { ok: false, status: 403 }, 'an app with no policy is not served to the LAN');
assert.deepEqual(L.x_app_default_wan, { ok: false, status: 403 });
assert.deepEqual(L.x_app_lan_policy, { ok: true });
assert.deepEqual(L.x_app_lan_policy_wan_peer, { ok: false, status: 403 });
assert.deepEqual(L.x_app_disabled, { ok: false, status: 404 });
assert.deepEqual(L.x_app_loopback_off, { ok: false, status: 403 });
assert.deepEqual(L.x_monad_guest_wan, { ok: false, status: 403 }, 'a guest monad has no connections, whatever its policy says');
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
function door(uri: string, connections: unknown, extra: Record<string, unknown> = {}, remote = '127.0.0.1', appPatch: Record<string, unknown> = {}, target = 'app:fulltrailer', method = 'GET') {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: { id0: { ...apps[0], ...appPatch } } }));
  fs.writeFileSync(path.join(dir, 'runtime', 'domain-map.json'), JSON.stringify({
    version: 1, domains: { [FT_HOST]: { type: 'server', target, ssl: { enabled: false }, connections, ...extra } },
  }));
  const r = spawnSync(resty, [harness, handler, dir, FT_HOST, 'text/html'], { env: { ...process.env, NETGET_DATA_DIR: dir, HARNESS_URI: uri, HARNESS_REMOTE: remote, HARNESS_METHOD: method }, encoding: 'utf8' });
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

// ── who may use a connection (the app's exposure policy; the monad's own paths are not affected) ──────────────────────
const LAN_PEER = '192.168.1.20', WAN_PEER = '8.8.8.8';
const fuelFrom = (remote: string, appPatch: Record<string, unknown> = {}, target?: string) => door('/api/fuel', conns, {}, remote, appPatch, target);
// no policy on the app: only a loopback peer
assert.equal(fuelFrom('127.0.0.1').exec, '@door_connection');
for (const remote of [LAN_PEER, WAN_PEER]) {
  const r = fuelFrom(remote);
  assert.equal(r.exit, 403, `no policy, ${remote}: refused`);
  assert.equal(r.reason, 'connection_forbidden');
  assert.equal(r.exec, undefined);
  assert.equal(r.target, '', 'not handed to the monad either');
}
// the app's own policy is what decides
const lan = { exposure: { enabled: true, visibility: 'lan', network: { allowLoopback: true, allowLan: true, allowWan: false } } };
assert.equal(fuelFrom(LAN_PEER, lan).exec, '@door_connection', 'visibility lan admits a LAN peer');
assert.equal(fuelFrom(WAN_PEER, lan).exit, 403, 'and not a public one');
const closed = { exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true, allowLan: true, allowWan: true } } };
assert.equal(fuelFrom(LAN_PEER, closed).exit, 403, 'visibility loopback wins over allowLan');
assert.equal(fuelFrom('127.0.0.1', { exposure: { enabled: false } }).exit, 404, 'a disabled app');
assert.equal(fuelFrom('127.0.0.1', { trust: 'guest' }).exit, 403, 'a guest app');
// authorization declared by the app (FullTrailer's real policy: reads open, destructive requires a session)
const real = { exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true, allowLan: false, allowWan: false },
  auth: { requiredForRead: false, requiredForDestructive: true, mode: 'session', rolesAllowed: ['admin'] } } };
const call = (uri: string, method: string, appPatch: Record<string, unknown>) => door(uri, conns, {}, '127.0.0.1', appPatch, 'app:fulltrailer', method);
assert.equal(call('/api/fuel', 'GET', real).exec, '@door_connection', 'a read is open as declared');
assert.equal(call('/uploads/a.png', 'GET', real).exec, '@door_connection');
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const r = call('/api/upload', method, real);
  assert.equal(r.exit, 403, `${method} requires a session: refused although the peer is loopback`);
  assert.equal(r.reason, 'authorization_required');
  assert.equal(r.exec, undefined, `${method}: never reaches the service`);
  assert.equal(r.target, '', `${method}: and is not handed to the monad`);
}
assert.equal(call('/api/upload', 'POST', {}).exit, 403, 'no declaration = required (fail closed)');
assert.equal(call('/api/upload', 'POST', { exposure: { auth: { requiredForDestructive: false } } }).exec, '@door_connection', 'only an explicit declaration opens it');
assert.equal(call('/api/fuel', 'GET', { exposure: { enabled: true, visibility: 'loopback', auth: { requiredForRead: true } } }).exit, 403, 'a read that the app declared as requiring a session');
assert.equal(call('/api/upload', 'POST', real).reason, 'authorization_required');
// a forwarded header is not a peer
{
  const r = door('/api/fuel', conns, {}, WAN_PEER);
  assert.equal(r.exit, 403, 'the connecting address decides');
}
// the app behind the door is not live: said as JSON, not handed to the monad or to a page
assert.equal(fuelFrom('127.0.0.1', { lastSeenMs: 1_000 }).exit, 503);
assert.equal(fuelFrom('127.0.0.1', { lastSeenMs: 1_000 }).reason, 'app_not_available');
// a door that points at a bare host:port has no app and therefore no policy: loopback only
assert.equal(fuelFrom('127.0.0.1', {}, '127.0.0.1:5173').exec, '@door_connection');
assert.equal(fuelFrom(LAN_PEER, {}, '127.0.0.1:5173').exit, 403);
// and the monad's own paths are untouched by any of this: a LAN peer asking for something that is not a connection
assert.equal(door('/operadores', conns, {}, LAN_PEER).target, 'http://127.0.0.1:4100');

console.log('door-connections-lua: ok');
