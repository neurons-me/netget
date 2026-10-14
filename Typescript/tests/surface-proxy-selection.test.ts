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
try { fs.writeFileSync(oldHandler, execFileSync('git', ['show', `89c5d9f^:Typescript/${handlerPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); haveOld = true; } catch { /* not in a git checkout */ }

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

function run(apps: any[], host: string, opts: { map?: Record<string, any>; extra?: Record<string, any>; accept?: string; old?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: Object.fromEntries(apps.map((a, i) => [`id${i}`, a])) }));
  if (opts.map || opts.extra) fs.writeFileSync(path.join(dir, 'runtime', 'domain-map.json'), JSON.stringify({ version: 1, domains: opts.map ?? {}, ...(opts.extra ?? {}) }));
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
  // Polls is the most recent registration (a tie would be decided by table iteration order, i.e. at random)
  const pollsNewest = [app(FT), app({ ...PS, seen: FRESH + 500 })];
  const before = run(pollsNewest, `fulltrailer.${ROOT}`, { old: true });
  assert.equal(before.identity, 'polls-identity', 'the previous selector sent the FullTrailer host to Polls (the bug)');
  assert.equal(run(pollsNewest, `fulltrailer.${ROOT}`).identity, 'ft-identity', 'the current one does not');
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

// 6. a handle under a root is answered only by the monad that is AUTHORIZED for that root. A monad that merely announces
//    the root (its namespace) is capable of attending it, it is not authorized to: authority is declared by the operator
//    (a wildcard route) or by the installation (map.roots), never by the announcement.
const rootMonad = app({ name: 'rootmonad', id: 'root-identity', port: 4300, namespace: ROOT });
const handle = `jabellae.${ROOT}`;
const authorizesRoot = (identity: string, name: string, root = ROOT) => ({ roots: { [root]: { app: name, identity, source: 'installation' } } });
assert.equal(run([app(FT), app(PS), rootMonad], handle, { map: {}, extra: authorizesRoot('root-identity', 'rootmonad') }).identity, 'root-identity', 'a handle goes to the authorized root monad');
assert.ok(!served(run([app(FT), app(PS), rootMonad], handle)), 'a monad that announces the root, with no authorization, is not handed its handles');
assert.ok(!served(run([app(FT), app(PS)], handle, { map: {}, extra: authorizesRoot('root-identity', 'rootmonad') })), 'with the authorized root absent, handles are not handed to whichever app shares the root tag');

// 7. a name registered as `localhost` is reached by its loopback literal (nginx would look `localhost` up in public DNS)
const localhostEp = run([app({ ...FT, endpoint: 'http://localhost:4100', directEndpoint: 'http://localhost:4100' })], `fulltrailer.${ROOT}`);
assert.equal(localhostEp.target, 'http://127.0.0.1:4100', 'localhost -> 127.0.0.1');

// 8. an IP request is unchanged: any live monad answers
const ip = run([app({ ...FT, seen: STALE }), app(PS)], '127.0.0.1');
assert.ok(served(ip) && ip.identity === 'polls-identity', 'IP request: any LIVE monad');

// 9. NAMED SPACES under a root (docs/NamedSpaces.md). An address is not an existence, and not a claim:
//    1) a route the operator DECLARED decides (exact first, then a wildcard `*.<root>`);  2) a monad that declares the exact
//    host;  3) the monad AUTHORIZED for the nearest enclosing root (map.roots: the installation's own root bound to its
//    monad's identity), handed the request as it came;  4) nobody is authorized for the address: a neutral "no content
//    available" that asserts nothing about claims and writes nothing.
//    An announcement is capability, never authority: a monad that says it serves a root does not become its destination.
const LOCALROOT = app({ name: 'netget', id: 'root-identity', port: 8161, namespace: 'localhost', claims: ['localhost'] });
const rootLive = [LOCALROOT, app(FT), app(PS)];
const LOCAL_AUTH = { roots: { localhost: { app: 'netget', identity: 'root-identity', source: 'installation' } } };
const withLocal = (opts: Record<string, any> = {}) => ({ map: {}, extra: LOCAL_AUTH, ...opts });
for (const h of ['whatever.localhost', 'a.b.localhost', 'jabellae.localhost']) {
  const r = run(rootLive, h, withLocal());
  assert.ok(served(r) && r.identity === 'root-identity' && r.target === 'http://127.0.0.1:8161', `${h} -> the authorized root monad, got ${JSON.stringify(r)}`);
}
// an announcement alone is not authority: the same registrations with nothing authorized serve nothing
for (const h of ['whatever.localhost', 'a.b.localhost']) {
  const r = run(rootLive, h, { map: {} });
  assert.ok(!served(r) && r.exit === 404, `${h}: announced but not authorized -> neutral shell, got ${JSON.stringify(r)}`);
}
// ...and an old registry that carries no authorization at all (an older projection) behaves the same: nothing is widened
assert.ok(!served(run(rootLive, 'whatever.localhost')), 'no domain map at all -> nothing is authorized');
// an impostor that announces the same root, newer, with another identity, is not the destination
const impostor = app({ name: 'impostor', id: 'impostor-identity', port: 8777, namespace: 'localhost', claims: ['localhost'], seen: FRESH + 900 });
for (const apps of [[LOCALROOT, impostor], [impostor, LOCALROOT]]) {
  const r = run(apps, 'whatever.localhost', withLocal());
  assert.ok(served(r) && r.identity === 'root-identity', `the authorized identity serves, the newer announcer does not: ${JSON.stringify(r)}`);
}
// the authorized monad is down: "not available". The announcer is never its replacement
const authDown = run([app({ ...LOCALROOT_ARGS(), seen: STALE }), impostor], 'whatever.localhost', withLocal());
assert.ok(!served(authDown) && authDown.exit === 503, `authorized + down -> 503, never the impostor: ${JSON.stringify(authDown)}`);
// an announcement cannot widen the authorized root: authorization for `localhost` says nothing about another root
const wider = app({ name: 'wider', id: 'wider-identity', port: 8666, namespace: 'me', claims: ['me'] });
assert.ok(!served(run([LOCALROOT, wider], 'whatever.me', withLocal())), 'a monad announcing `me` is not authorized for `*.me`');
// a name whose app declares it is that app (exact declaration, unchanged)
assert.equal(run([LOCALROOT, app({ ...FT, claims: ['fulltrailer.localhost'] })], 'fulltrailer.localhost', withLocal()).identity, 'ft-identity', 'a name an app declares is that app');
// the nearest enclosing authorized root: names under an app's own authorized root go to it, not to `localhost`
const ftRoot = { roots: { ...LOCAL_AUTH.roots, [`fulltrailer.${ROOT}`]: { app: 'fulltrailer', identity: 'ft-identity', source: 'operator' } } };
assert.equal(run(rootLive, `x.fulltrailer.${ROOT}`, { map: {}, extra: ftRoot }).identity, 'ft-identity', 'the nearest authorized root attends');
// a suffix is a label boundary, not a substring
for (const h of ['evillocalhost', 'x.notlocalhost', 'localhost.evil.test']) {
  const r = run(rootLive, h, withLocal());
  assert.ok(!served(r), `${h} must not be handed to the localhost root: ${JSON.stringify(r)}`);
}
// the root itself is a name, not a descendant: `localhost` is answered by what declares it, as before
assert.equal(run(rootLive, 'localhost', withLocal()).identity, 'root-identity');

// ── the operator's declarations come first, and a wildcard is a declaration ──
const exactCamiones = { 'camiones.localhost': { type: 'proxy', target: 'app:fulltrailer', protocol: 'http', ssl: { enabled: false } } };
const camiones = run(rootLive, 'camiones.localhost', withLocal({ map: exactCamiones }));
assert.ok(served(camiones) && camiones.identity === 'ft-identity' && camiones.target === 'http://127.0.0.1:4100', `declared name -> its app: ${JSON.stringify(camiones)}`);
const camionesDown = run([LOCALROOT, app({ ...FT, seen: STALE })], 'camiones.localhost', withLocal({ map: exactCamiones }));
assert.ok(!served(camionesDown) && camionesDown.exit === 503 && /not available/.test(camionesDown.reason ?? ''), `declared + down: ${JSON.stringify(camionesDown)}`);
// a wildcard route `*.localhost` -> an app: every name under it goes there, a more specific exact route still wins,
// and it also overrides the installation's own default for the same root
const wild = { '*.localhost': { type: 'proxy', target: 'app:polls-studio', protocol: 'http', ssl: { enabled: false } }, ...exactCamiones };
const w1 = run(rootLive, 'cualquiera.localhost', withLocal({ map: wild }));
assert.ok(served(w1) && w1.identity === 'polls-identity', `a wildcard declaration -> its app, over the installation's default: ${JSON.stringify(w1)}`);
assert.equal(run(rootLive, 'camiones.localhost', withLocal({ map: wild })).identity, 'ft-identity', 'an exact route beats the wildcard');
assert.equal(run(rootLive, 'a.b.localhost', withLocal({ map: wild })).identity, 'polls-identity', 'a wildcard attends names with levels');
assert.ok(!served(run(rootLive, 'evillocalhost', withLocal({ map: wild }))), 'a wildcard is a label boundary too');
// the longest wildcard wins
const twoWild = { '*.localhost': wild['*.localhost'], '*.taller.localhost': { type: 'proxy', target: 'app:fulltrailer', protocol: 'http', ssl: { enabled: false } } };
assert.equal(run(rootLive, 'x.taller.localhost', withLocal({ map: twoWild })).identity, 'ft-identity', 'the longest wildcard wins');
// a wildcard that is not `*.<name>` is not a route
const badWild = { '*': { type: 'proxy', target: 'app:fulltrailer' }, 'a*.localhost': { type: 'proxy', target: 'app:fulltrailer' }, '*.*.localhost': { type: 'proxy', target: 'app:fulltrailer' } };
for (const h of ['whatever.localhost', 'anything.test', 'ax.localhost']) {
  assert.notEqual(run(rootLive, h, { map: badWild }).identity, 'ft-identity', `${h}: a malformed wildcard is not a route`);
}

// ── two identities for ONE authorized app name: rejected, never the most recent ──
const ft2 = app({ name: 'fulltrailer', id: 'ft-other-identity', port: 4199, seen: FRESH + 700 });
for (const apps of [[app(FT), ft2], [ft2, app(FT)]]) {
  const r = run(apps, 'camiones.localhost', { map: exactCamiones });
  assert.ok(!served(r) && r.exit === 503 && /conflict/.test(r.reason ?? ''), `declared app name held by two identities -> conflict: ${JSON.stringify(r)}`);
}
// ...and the same registration repeated by ONE identity is not a conflict (the most recent of it serves)
const ftAgain = app({ ...FT, port: 4101, seen: FRESH + 100 });
const same = run([app(FT), ftAgain], 'camiones.localhost', { map: exactCamiones });
assert.ok(served(same) && same.identity === 'ft-identity' && same.target === 'http://127.0.0.1:4101', `one identity registered twice serves: ${JSON.stringify(same)}`);

// ── nobody authorized for the address: the neutral shell (404), nothing asserted ──
const none = run([app(FT), app(PS)], 'whatever.localhost', { accept: 'text/html' });
assert.ok(!served(none) && none.exit === 404, `no authorized root -> 404: ${JSON.stringify(none)}`);
assert.ok(/Sin contenido disponible para esta dirección/.test((none as any).text ?? ''), `neutral wording: ${(none as any).text}`);
assert.ok(!/reclam|claim|no existe|not exist/i.test((none as any).text ?? ''), 'it does not say anything about claims or existence');
const noneJson = run([app(FT), app(PS)], 'whatever.localhost', { accept: 'application/json' });
assert.ok(noneJson.exit === 404 && noneJson.reason === 'no_content_available', `json: ${JSON.stringify(noneJson)}`);
function LOCALROOT_ARGS() { return { name: 'netget', id: 'root-identity', port: 8161, namespace: 'localhost', claims: ['localhost'] }; }

console.log('surface-proxy-selection: ok');
fs.rmSync(tmp, { recursive: true, force: true });
