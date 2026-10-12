import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// surface_proxy.lua: which monad answers for a host.
//   * a DECLARED route (domain-map.json, `app:<name>`) is the authority, and "not available" never falls back;
//   * otherwise only monads that DECLARE the host as their own can serve it; two identities that do -> a conflict;
//   * tags / the machine's name / a shared root tag never select a monad;
//   * registration order and recency never decide between identities.
const resty = ['/usr/local/openresty/bin/resty', '/opt/homebrew/bin/resty', '/usr/local/bin/resty'].find((p) => fs.existsSync(p));
if (!resty) {
  console.log('surface-proxy-selection: skipped (no resty on this machine)');
  process.exit(0);
}
const harness = path.resolve('tests/lua/surface_proxy_harness.lua');
const handlerPath = 'src/modules/NetGetX/OpenResty/lua/handlers/surface_proxy.lua';
const handler = path.resolve(handlerPath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
const oldHandler = path.join(tmp, 'surface_proxy.old.lua');
let haveOld = false;
try { fs.writeFileSync(oldHandler, execFileSync('git', ['show', `HEAD:Typescript/${handlerPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); haveOld = true; } catch { /* not in a git checkout */ }

const ROOT = 'suis-macbook-air.local';
const FRESH = 1_999_000, STALE = 1_000_000; // now = 2000 s -> 2_000_000 ms; ttl 12 s
type AppOpts = { name: string; id: string; port: number; seen?: number; tags?: string[]; claims?: string[]; namespace?: string; endpoint?: string; directEndpoint?: string };
const app = (o: AppOpts) => ({
  name: `monad:${o.name}`, host: '127.0.0.1', port: o.port, ttlMs: 12000, lastSeenMs: o.seen ?? FRESH, trust: 'peer',
  tags: o.tags ?? ['127.0.0.1', 'local', 'monad', ROOT, `surface:${o.name}`],
  metadata: {
    monadName: o.name, namespace: o.namespace ?? `${o.name}.${ROOT}`, identity: o.namespace ?? `${o.name}.${ROOT}`,
    identity_hash: o.id, hostname: 'Suis-MacBook-Air.local',
    endpoint: o.endpoint ?? `http://127.0.0.1:${o.port}`, directEndpoint: o.directEndpoint ?? `http://127.0.0.1:${o.port}`,
    claimed_namespaces: o.claims ?? [o.namespace ?? `${o.name}.${ROOT}`],
  },
});
const FT = { name: 'fulltrailer', id: 'ft-identity', port: 4100 };
const PS = { name: 'polls-studio', id: 'polls-identity', port: 4200, namespace: `polls-studio.${ROOT}` };

function run(apps: any[], host: string, opts: { map?: Record<string, any>; accept?: string; old?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: Object.fromEntries(apps.map((a, i) => [`id${i}`, a])) }));
  if (opts.map) fs.writeFileSync(path.join(dir, 'runtime', 'domain-map.json'), JSON.stringify({ version: 1, domains: opts.map }));
  const r = spawnSync(resty, [harness, opts.old ? oldHandler : handler, dir, host, opts.accept ?? 'application/json'], { env: { ...process.env, NETGET_DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.trim().split('\n').pop() as string;
  return JSON.parse(line) as { exit?: number; target: string; identity: string; error?: string; reason?: string; log?: string };
}
const served = (r: any) => r.exit === undefined && r.target !== '';

// 1. the bug this fixes: two apps share the root tag and both are live; the host names one of them.
const both = [app(PS), app(FT)];                 // Polls registered/seen first AND most recently
const bothReversed = [app(FT), app(PS)];
for (const apps of [both, bothReversed]) {
  const ft = run(apps, `fulltrailer.${ROOT}`);
  assert.ok(served(ft) && ft.identity === 'ft-identity' && ft.target === 'http://127.0.0.1:4100', `fulltrailer host -> FullTrailer, got ${JSON.stringify(ft)}`);
  const ps = run(apps, `polls-studio.${ROOT}`);
  assert.ok(served(ps) && ps.identity === 'polls-identity' && ps.target === 'http://127.0.0.1:4200', `polls host -> Polls, got ${JSON.stringify(ps)}`);
}
// recency must not matter either
const polls_newer = [app({ ...FT, seen: FRESH - 5000 }), app({ ...PS, seen: FRESH })];
assert.equal(run(polls_newer, `fulltrailer.${ROOT}`).identity, 'ft-identity', 'a more recent registration of another app does not take the host');
if (haveOld) {
  const before = run(both, `fulltrailer.${ROOT}`, { old: true });
  assert.equal(before.identity, 'polls-identity', 'the previous selector sent the FullTrailer host to Polls (the bug)');
}

// 2. an app that is down is "not live", never another app
const ftDown = [app({ ...FT, seen: STALE }), app(PS)];
const r2 = run(ftDown, `fulltrailer.${ROOT}`);
assert.ok(!served(r2) && r2.exit === 503, 'FullTrailer stale -> unavailable, not Polls');
assert.notEqual(r2.identity, 'polls-identity');
assert.ok(/not live/.test(r2.reason ?? ''), `says it is not live: ${r2.reason}`);
// and the other one keeps working while FullTrailer is down
assert.equal(run(ftDown, `polls-studio.${ROOT}`).identity, 'polls-identity');

// 3. two identities declare the same host, nothing declared -> conflict, in either order
const rogue = app({ name: 'imposter', id: 'rogue-identity', port: 4900, claims: [`fulltrailer.${ROOT}`] });
for (const apps of [[app(FT), rogue], [rogue, app(FT)]]) {
  const r = run(apps, `fulltrailer.${ROOT}`);
  assert.ok(!served(r) && r.exit === 503, 'conflict is not served');
  assert.ok(/conflict/.test(r.reason ?? ''), `says conflict: ${r.reason}`);
  assert.ok(/ft-identity/.test(r.log ?? '') && /rogue-identity/.test(r.log ?? ''), 'both identities are logged');
}

// 4. a declared route settles it (and is the authority over declared claims)
const declared = { [`fulltrailer.${ROOT}`]: { type: 'proxy', target: 'app:fulltrailer', protocol: 'http', ssl: { enabled: false } } };
for (const apps of [[app(FT), rogue], [rogue, app(FT)]]) {
  const r = run(apps, `fulltrailer.${ROOT}`, { map: declared });
  assert.ok(served(r) && r.identity === 'ft-identity' && r.target === 'http://127.0.0.1:4100', `declared route wins over a rival claim: ${JSON.stringify(r)}`);
}
// a declared target that is not live does NOT fall back to a claimant
const r4 = run([app({ ...FT, seen: STALE }), rogue], `fulltrailer.${ROOT}`, { map: declared });
assert.ok(!served(r4) && r4.exit === 503 && /not available/.test(r4.reason ?? ''), `declared + down = not available: ${JSON.stringify(r4)}`);
// a declared target that names an app which does not exist
const r4b = run([app(PS)], `fulltrailer.${ROOT}`, { map: declared });
assert.ok(!served(r4b) && /not available/.test(r4b.reason ?? ''), 'declared app that is not registered is not available (and Polls does not take it)');
// a declared host:port is used as written
const direct = run([app(PS)], `fulltrailer.${ROOT}`, { map: { [`fulltrailer.${ROOT}`]: { type: 'server', target: '127.0.0.1:4100', protocol: 'http', ssl: { enabled: false } } } });
assert.ok(served(direct) && direct.target === 'http://127.0.0.1:4100', 'declared host:port');
// the declared route is by name, by the short name as well as the registry name
const byRegistryName = run([app(FT)], `fulltrailer.${ROOT}`, { map: { [`fulltrailer.${ROOT}`]: { type: 'proxy', target: 'app:monad:fulltrailer' } } });
assert.ok(served(byRegistryName) && byRegistryName.identity === 'ft-identity', 'app:monad:<name> (what `netget routing` writes) resolves');

// 5. advertisements never select: a tag equal to the host, the root tag, the machine name
const tagged = app({ name: 'tagsonly', id: 'tags-identity', port: 4800, namespace: `tagsonly.${ROOT}`, claims: [], tags: [`fulltrailer.${ROOT}`, ROOT, 'local'] });
const r5 = run([tagged], `fulltrailer.${ROOT}`);
assert.ok(!served(r5), 'a tag naming the host does not route to the monad that advertises it');

// 6. a handle under a root is answered only by a monad that IS the root
const rootMonad = app({ name: 'rootmonad', id: 'root-identity', port: 4300, namespace: ROOT });
const handle = `jabellae.${ROOT}`;
assert.equal(run([app(FT), app(PS), rootMonad], handle).identity, 'root-identity', 'a handle goes to the root monad');
assert.ok(!served(run([app(FT), app(PS)], handle)), 'with no root monad, handles are not handed to whichever app shares the root tag');

// 7. a name registered as `localhost` is reached by its loopback literal (nginx would look `localhost` up in public DNS)
const localhostEp = run([app({ ...FT, endpoint: 'http://localhost:4100', directEndpoint: 'http://localhost:4100' })], `fulltrailer.${ROOT}`);
assert.equal(localhostEp.target, 'http://127.0.0.1:4100', 'localhost -> 127.0.0.1');

// 8. an IP request is unchanged: any live monad answers
const ip = run([app({ ...FT, seen: STALE }), app(PS)], '127.0.0.1');
assert.ok(served(ip) && ip.identity === 'polls-identity', 'IP request: any LIVE monad');

console.log('surface-proxy-selection: ok');
fs.rmSync(tmp, { recursive: true, force: true });
