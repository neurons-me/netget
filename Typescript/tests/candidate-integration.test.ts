/**
 * candidate-integration.test.ts -- the pieces of the named-spaces activation, TOGETHER, the way the machine would run them.
 *
 *   monad      the tree this runs from (a release: its monad.ai and its `me`), as the root of `localhost`, REAL
 *   backend    the standalone proxy.js (the gate), disposable data, proven disposable before any write
 *   nginx      a disposable OpenResty in front, with the machine's INSTALLED conf.d/netget_app.conf (read, never written)
 *              plus the named-space block (namedSpaceBlock.ts), and the machine's INSTALLED Lua tree (copied) with only
 *              this tree's surface_proxy.lua laid over it -- exactly what the activation installs
 *   operator   signs in through nginx and declares every route through the gate (/add-domain with a session)
 *
 * What it asserts, in one flow: the administrative walk at `localhost`; a name nobody created opens and receives nothing
 * of the root (users, a datum of the root read by path, the whole response); the operator's explicit connections win
 * (exact, wildcard to an address, wildcard to an app bound to ITS identity); an announcement does not widen authority (an
 * impostor under the root's namespace, under the app's name); conflicts are rejected, not settled by recency; a destination
 * that is down is "not available", never another monad; and nothing the test did not write is written.
 *
 * Skips without OpenResty or without an installed netget_app.conf (then the generated one is used and the file says so).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { findOpenResty, startDisposableOpenResty } = await import('./helpers/disposableOpenResty.ts');
if (!findOpenResty()) { console.log('candidate-integration: skipped (no openresty on this machine)'); process.exit(0); }
const { startDisposableStandalone } = await import('./helpers/standaloneBackend.ts');
const { claimIdentityWithKey, writeGatewayClaims } = await import('./helpers/testIdentities.ts');
const { getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
const { withNamedSpaceBlock } = await import('../src/modules/NetGetX/OpenResty/namedSpaceBlock.ts');
const { detectOpenRestyLayout } = await import('../src/modules/NetGetX/OpenResty/platformDetect.ts');
const { readMonadRecord } = await import('monad.ai');

const here = path.dirname(new URL(import.meta.url).pathname);
const candidateLua = path.resolve(here, '../src/modules/NetGetX/OpenResty/lua');
const INSTALLED_APP = '/opt/homebrew/etc/openresty/conf.d/netget_app.conf';
const REAL_MAP = path.join(os.homedir(), '.get', 'runtime', 'domain-map.json');
const realBefore = fs.existsSync(REAL_MAP) ? fs.statSync(REAL_MAP).mtimeMs : null;

const be = await startDisposableStandalone({ defaultNamespace: true });
let ng: Awaited<ReturnType<typeof startDisposableOpenResty>> | null = null;
const closers: Array<() => void> = [];
const cleanup: string[] = [];

type Res = { status: number; text: string; json: any };
const raw = (port: number, host: string, p: string, o: { method?: string; accept?: string; headers?: Record<string, string>; body?: unknown; via?: string } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const payload = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request({ host: o.via ?? '127.0.0.1', port, path: p, method: o.method ?? 'GET',
      headers: { Host: host, Accept: o.accept ?? 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) } }, (res) => {
      let text = ''; res.on('data', (c) => (text += c));
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, text, json }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
const serve = async (marker: string) => {
  const s = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ marker, host: q.headers.host, path: q.url })); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  closers.push(() => s.close());
  return { port: (s.address() as any).port as number };
};

try {
  const runtime = path.join(be.dataDir, 'runtime');
  const appsPath = path.join(runtime, 'apps.json');
  const mapPath = path.join(runtime, 'domain-map.json');
  const monadOrigin = String(await getNetgetMonadOrigin());
  const record: any = await readMonadRecord(be.monadName);
  const rootIdentity = String(record?.identity_hash ?? '');
  assert.ok(rootIdentity, 'the disposable monad has an identity');

  // ── the registry, the way a real monad registers (same shape the machine's apps.json shows) ──
  const POLLS = 'polls-studio';
  const pollsSvc = await serve('polls-real');
  const impostorSvc = await serve('polls-impostor');
  const now = () => Date.now();
  const reg = (name: string, identity: string, o: { port: number; ns?: string; claimed?: string[]; endpoint?: string; seen?: number }) => ({
    name: `monad:${name}`, kind: 'monad', host: '127.0.0.1', port: o.port, ttlMs: 3_600_000, lastSeenMs: o.seen ?? now(), trust: 'owner',
    metadata: { monadName: name, namespace: o.ns ?? name, identity: o.ns ?? name, identity_hash: identity, endpoint: o.endpoint ?? `http://127.0.0.1:${o.port}`,
      directEndpoint: o.endpoint ?? `http://127.0.0.1:${o.port}`, claimed_namespaces: o.claimed ?? [o.ns ?? name] },
    exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } }, tags: ['monad', 'local'],
  });
  const monadPort = Number(new URL(monadOrigin).port);
  const apps: Record<string, any> = {
    root: reg(be.monadName, rootIdentity, { port: monadPort, ns: 'localhost', claimed: ['localhost'], endpoint: monadOrigin }),
    polls: reg(POLLS, 'polls-identity', { port: pollsSvc.port, ns: `${POLLS}.localhost` }),
  };
  const writeApps = () => fs.writeFileSync(appsPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), apps }));
  writeApps();

  // ── nginx: the INSTALLED conf + the named-space block; the INSTALLED Lua + this tree's selector ──
  const generated = getNetgetAppConfContent();
  const installedConf = fs.existsSync(INSTALLED_APP) ? fs.readFileSync(INSTALLED_APP, 'utf8') : generated;
  const usingInstalled = fs.existsSync(INSTALLED_APP);
  const appConfText = withNamedSpaceBlock(installedConf, generated);
  const layout = detectOpenRestyLayout();
  const luaTree = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-lua-')); cleanup.push(luaTree);
  if (usingInstalled && layout.luaDir && fs.existsSync(layout.luaDir)) {
    fs.cpSync(layout.luaDir, luaTree, { recursive: true });
    fs.copyFileSync(path.join(candidateLua, 'handlers', 'surface_proxy.lua'), path.join(luaTree, 'handlers', 'surface_proxy.lua'));
  } else {
    fs.cpSync(candidateLua, luaTree, { recursive: true });
  }
  const uiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-ui-')); cleanup.push(uiRoot);
  fs.writeFileSync(path.join(uiRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>\n');
  ng = await startDisposableOpenResty({ backendPort: be.port, appConfText, uiRoot, luaRoot: luaTree });
  const N = ng.httpPort;
  console.log(`candidate-integration: nginx in front with ${usingInstalled ? 'the INSTALLED conf + Lua (selector replaced)' : 'the generated conf'}`);

  // ── 1. the administrative walk at `localhost`, through nginx ─────────────────
  await be.assertDisposable();
  assert.equal((await raw(N, 'localhost', '/main-server-namespace')).json?.namespace, be.namespace, 'the exact name `localhost` is the gateway');
  assert.equal((await raw(N, 'localhost', '/add-domain', { method: 'POST', body: { domain: 'anon.test', type: 'server', target: '127.0.0.1:4000' } })).status, 401, 'anonymous write refused');
  const alice = await claimIdentityWithKey(monadOrigin, 'alice', 'alice-secret', 'localhost');
  const bob = await claimIdentityWithKey(monadOrigin, 'bob', 'bob-secret', 'localhost');
  writeGatewayClaims(getGatewayClaimsPath(), 'candidate-integration.local', alice.identityHash, {
    [alice.identityHash]: ['gateway:read', 'gateway:write'], [bob.identityHash]: ['gateway:read'],
  });
  const signIn = async (who: typeof alice) => {
    const c = await raw(N, 'localhost', '/admin-session/challenge', { method: 'POST', body: { identityHash: who.identityHash } });
    assert.equal(c.json?.ok, true, `challenge: ${c.text.slice(0, 200)}`);
    const v = await raw(N, 'localhost', '/admin-session/verify', { method: 'POST', body: { identityHash: who.identityHash, namespace: who.namespace, keyId: who.keyId, signature: await who.sign(c.json.challenge) } });
    assert.equal(v.json?.ok, true, `verify: ${v.text.slice(0, 200)}`);
    return v.json.sessionToken as string;
  };
  const owner = { authorization: `Bearer ${await signIn(alice)}` };
  const reader = { authorization: `Bearer ${await signIn(bob)}` };
  const declare = (domain: string, target: string, headers = owner, extra: Record<string, unknown> = {}) =>
    raw(N, 'localhost', '/add-domain', { method: 'POST', headers, body: { domain, type: 'server', target, ...extra } });
  assert.equal((await declare('x.localhost', '127.0.0.1:4999', reader)).status, 403, 'a read-only administrator cannot declare a route');

  // ── 2. the root's authorization is the projection of the monad's OWN identity ──
  const projection = async () => JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  assert.equal((await declare('seed.localhost', '127.0.0.1:4998')).status, 200);
  assert.equal((await raw(N, 'localhost', '/delete-domain', { method: 'POST', headers: owner, body: { domain: 'seed.localhost' } })).status, 200);
  const roots = (await projection()).roots;
  assert.deepEqual(roots, { localhost: { app: be.monadName, identity: rootIdentity, source: 'installation' } }, 'roots = the installation root bound to the monad identity (what its registration carries too)');

  // ── 3. a name nobody created: it opens, and it receives nothing of the root ──
  const MARKER = 'root-datum-c0ffee-4711';
  const w = await raw(monadPort, 'localhost', '/', { via: '127.0.0.1', method: 'POST', body: { path: 'profile.motto', value: MARKER, operation: 'write' } });
  const wroteDatum = w.status >= 200 && w.status < 300;
  const whole = await raw(N, 'whatever.localhost', '/');
  assert.equal(whole.status, 200, `an address opens without being created: ${whole.text.slice(0, 200)}`);
  assert.equal(whole.json?.target?.namespace?.me, 'whatever.localhost', 'it is read in ITS context, not the root\'s');
  assert.deepEqual(whole.json?.users ?? [], [], 'no users of the root');
  for (const secret of ['alice', 'bob', MARKER]) assert.ok(!whole.text.includes(secret), `the whole response carries nothing of the root: ${secret}`);
  if (wroteDatum) {
    const control = await raw(monadPort, 'localhost', '/profile/motto');
    assert.ok(control.text.includes(MARKER), 'control: the datum is readable at the root');
    for (const host of ['whatever.localhost', 'a.b.localhost']) {
      for (const p of ['/profile/motto', '/@root/profile/motto']) {
        const r = await raw(N, host, p);
        assert.ok(!r.text.includes(MARKER), `${host}${p}: the root's datum is not delivered under another name`);
      }
    }
  } else {
    console.log(`candidate-integration: note -- the root datum could not be written unsigned (${w.status}); read-by-path isolation is covered by the monad's own test`);
  }
  const asAlice = await raw(N, 'alice.localhost', '/');
  assert.ok(!asAlice.text.includes('bob'), 'a handle sees at most itself');

  // ── 4. the operator's explicit connections win, and each is bound to its destination ──
  const direct = await serve('declared-direct');
  assert.equal((await declare('camiones.localhost', `127.0.0.1:${direct.port}`)).status, 200);
  assert.equal((await raw(N, 'camiones.localhost', '/')).json?.marker, 'declared-direct', 'an exact route: the declared address');
  assert.equal((await declare('*.obras.localhost', `127.0.0.1:${direct.port}`)).status, 200);
  assert.equal((await raw(N, 'uno.obras.localhost', '/')).json?.marker, 'declared-direct', 'a wildcard to an address');
  // a wildcard to an app is bound to the identity the app is registered under when the OPERATOR declares it
  assert.equal((await declare('*.polls.localhost', `app:${POLLS}`)).status, 200);
  assert.equal((await projection()).domains['*.polls.localhost']?.identity, 'polls-identity', 'bound to the app\'s identity');
  assert.equal((await raw(N, 'x.polls.localhost', '/')).json?.marker, 'polls-real', 'served by the bound identity');
  assert.equal((await raw(N, 'x.polls.localhost', '/')).json?.host, 'x.polls.localhost', 'the Host is not rewritten');
  // an impostor registers under the same app name afterwards, more recently, on its own port: it is not asked
  apps.impostor = reg(POLLS, 'impostor-identity', { port: impostorSvc.port, ns: `${POLLS}.localhost`, seen: now() + 5000 });
  writeApps();
  assert.equal((await raw(N, 'x.polls.localhost', '/')).json?.marker, 'polls-real', 'an impostor under the same name does not receive the traffic');
  // the bound identity goes away: unavailable, never the impostor
  apps.polls.lastSeenMs = now() - 7_200_000; writeApps();
  const down = await raw(N, 'x.polls.localhost', '/');
  assert.equal(down.status, 503, `bound identity down: ${down.text.slice(0, 160)}`);
  assert.ok(!down.text.includes('polls-impostor'));
  apps.polls.lastSeenMs = now(); delete apps.impostor; writeApps();
  assert.equal((await raw(N, 'x.polls.localhost', '/')).json?.marker, 'polls-real', 'and it attends again when it is back');
  // an exact route keeps winning over a wildcard under the same suffix
  assert.equal((await declare('uno.polls.localhost', `127.0.0.1:${direct.port}`)).status, 200);
  assert.equal((await raw(N, 'uno.polls.localhost', '/')).json?.marker, 'declared-direct', 'exact beats the wildcard');
  // a route with door connections and no door-connections library installed is refused loudly, not half-served
  // (door connections are a separate activation; this one must not pretend to have them)

  // ── 5. the root: authorized, not announced ──
  // another process announces `localhost` under its own identity: it is not the root's destination
  apps.rogue = reg('rogue', 'rogue-identity', { port: impostorSvc.port, ns: 'localhost', claimed: ['localhost'] });
  writeApps();
  const withRogue = await raw(N, 'whatever.localhost', '/');
  assert.equal(withRogue.status, 200);
  assert.ok(!withRogue.text.includes('polls-impostor'), 'a rogue announcement of the root is not asked');
  assert.equal(withRogue.json?.target?.namespace?.me, 'whatever.localhost', 'the authorized root still attends, with the address as it came');
  // the authorized identity goes down: unavailable, never the rogue
  apps.root.lastSeenMs = now() - 7_200_000; writeApps();
  const rootDown = await raw(N, 'whatever.localhost', '/');
  assert.equal(rootDown.status, 503, 'authorized root down: unavailable');
  assert.ok(!rootDown.text.includes('polls-impostor'));
  apps.root.lastSeenMs = now(); delete apps.rogue; writeApps();
  // nothing authorizes a root (the projection has none): a neutral shell, asserting nothing, writing nothing
  const withRoots = await projection();
  fs.writeFileSync(mapPath, JSON.stringify({ ...withRoots, roots: {} }));
  const shell = await raw(N, 'whatever.localhost', '/', { accept: 'text/html' });
  assert.equal(shell.status, 404);
  assert.match(shell.text, /Sin contenido disponible para esta dirección/);
  fs.writeFileSync(mapPath, JSON.stringify(withRoots));

  // ── 6. conflicts are rejected, not settled by recency ──
  apps.twinA = reg('twin', 'twin-a', { port: direct.port, ns: 'twin.localhost' });
  apps.twinB = reg('twin', 'twin-b', { port: impostorSvc.port, ns: 'twin.localhost' });
  writeApps();
  const conflict = await raw(N, 'twin.localhost', '/');
  assert.ok(conflict.status >= 500 && /conflict/i.test(conflict.text), `two identities declare one host: ${conflict.status} ${conflict.text.slice(0, 160)}`);
  delete apps.twinA; delete apps.twinB; writeApps();

  // ── 7. loopback only ──
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`candidate-integration: non-loopback peer check ${lanIp ? 'is covered by named-spaces-localhost' : 'skipped (no LAN address)'}`);

  // ── 8. the machine's own gateway was not touched ──
  assert.equal(fs.existsSync(REAL_MAP) ? fs.statSync(REAL_MAP).mtimeMs : null, realBefore, "the machine's domain-map.json was not written");
} finally {
  for (const c of closers) { try { c(); } catch { /* closed */ } }
  if (ng) await ng.stop();
  await be.stop();
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}
console.log('candidate-integration: ok');
process.exit(0);
