/**
 * named-spaces-localhost.test.ts -- `<name>.localhost` through a disposable OpenResty, in front of the real standalone
 * backend and a disposable root monad (namespace `localhost`, the machine's default). docs/NamedSpaces.md is the contract:
 *
 *   address, existence and claim are three things. An address can open a surface without anything having been created or
 *   claimed. Order: (1) a route the operator DECLARED; (2) the monad that IS the nearest enclosing root attends the address
 *   with its full context; (3) a neutral "no content available" that asserts nothing about claims and writes nothing.
 *   The root's admin panel is never the answer for a name, and a name never reaches the gateway's admin API.
 *
 * Two layers, kept apart because they belong to different components:
 *   - routing (netget: nginx + surface_proxy.lua): WHO attends an address and WITH WHAT. The root is a stand-in monad that
 *     answers with the Host and path it received, so what is asserted is that the request arrives as it came.
 *   - resolution (monad + me): what a root makes of that Host. NAMED_SPACE_REAL_MONAD=1 puts the disposable real monad in
 *     the root's place (run it from a tree whose monad.ai knows one-label roots, e.g. a release).
 *
 * Disposable only (the backend proves it is the disposable one before any write; nothing here writes except the test's own
 * files). Skips without OpenResty.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { findOpenResty, startDisposableOpenResty } = await import('./helpers/disposableOpenResty.ts');
if (!findOpenResty()) { console.log('named-spaces-localhost: skipped (no openresty on this machine)'); process.exit(0); }
const { startDisposableStandalone } = await import('./helpers/standaloneBackend.ts');
const { writeAppsRegistry } = await import('./helpers/testIdentities.ts');
const { getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');

const REAL_MAP = path.join(os.homedir(), '.get', 'runtime', 'domain-map.json');
const realBefore = fs.existsSync(REAL_MAP) ? fs.statSync(REAL_MAP).mtimeMs : null;

const be = await startDisposableStandalone({ defaultNamespace: true });
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
let ng: Awaited<ReturnType<typeof startDisposableOpenResty>> | null = null;
let service: http.Server | null = null;
let rootStandIn: http.Server | null = null;
const realMonad = process.env.NAMED_SPACE_REAL_MONAD === '1';

type Res = { status: number; type: string; text: string; json: any };
const call = (host: string, p = '/', { accept = 'application/json', method = 'GET', via = '127.0.0.1', body }: { accept?: string; method?: string; via?: string; body?: unknown } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const req = http.request({ host: via, port: ng!.httpPort, path: p, method, headers: { Host: host, Accept: accept, ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json: any = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });

try {
  ng = await startDisposableOpenResty({
    backendPort: be.port,
    luaRoot: path.resolve('src/modules/NetGetX/OpenResty/lua'),
    ...(lanIp ? { lanIp } : {}),
  });
  const runtime = path.join(be.dataDir, 'runtime');
  // the root: the disposable real monad, or a stand-in that reports the Host and path it was given
  let rootOrigin: string;
  if (realMonad) {
    rootOrigin = String(await getNetgetMonadOrigin());
  } else {
    rootStandIn = http.createServer((q, r) => {
      r.setHeader('content-type', 'application/json');
      r.end(JSON.stringify({ rootStandIn: true, host: q.headers.host, path: q.url, forwardedHost: q.headers['x-forwarded-host'] ?? null }));
    });
    await new Promise<void>((r) => rootStandIn!.listen(0, '127.0.0.1', () => r()));
    rootOrigin = `http://127.0.0.1:${(rootStandIn!.address() as any).port}`;
  }
  writeAppsRegistry(runtime, be.namespace, rootOrigin);
  const appsPath = path.join(runtime, 'apps.json');
  const mapPath = path.join(runtime, 'domain-map.json');
  const registry = () => JSON.parse(fs.readFileSync(appsPath, 'utf8'));
  const snapshot = () => fs.readdirSync(be.dataDir, { recursive: true }).map(String).filter((f) => !/backend\.(log|pid)$|\.log$/.test(f)).sort();

  // a service the operator can point a name at
  service = http.createServer((_q, r) => r.end('servicio-declarado'));
  await new Promise<void>((r) => service!.listen(0, '127.0.0.1', () => r()));
  const svcPort = (service!.address() as any).port;

  // what the root was handed: the Host it received (stand-in), or the namespace it resolved from it (real monad)
  const seen = (r: Res) => (realMonad ? r.json?.target?.namespace?.me : r.json?.host);
  const seenPath = (r: Res) => (realMonad ? r.json?.target?.path : r.json?.path);
  // the disposable proof, then every request below goes to nginx (loopback) with an explicit Host
  await be.assertDisposable();
  assert.equal((await call('localhost', '/main-server-namespace')).json?.namespace, be.namespace, 'the exact name `localhost` is still the gateway (admin block)');

  // ── 2. no declaration: the root monad attends the address, with the full context ──
  const open = await call('whatever.localhost', '/');
  assert.equal(open.status, 200, 'an address opens without having been created or claimed');
  assert.equal(seen(open), 'whatever.localhost', `the address asked for, not the root's: ${open.text.slice(0, 400)}`);
  if (realMonad) assert.equal(open.json?.rootNamespace, 'localhost');
  const nested = await call('a.b.localhost', '/');
  if (realMonad) {
    // The root monad (monad + me) resolves ONE handle under a root; a nested name arrives, but it is "unknown" to it. What
    // matters here is that it is never answered as the root itself. (A gap of the monad's resolver, not of the routing.)
    assert.notEqual(seen(nested), 'localhost', 'a nested name is never answered as the root');
    console.log(`named-spaces-localhost: note -- the monad resolves a.b.localhost as ${JSON.stringify(seen(nested))}`);
  } else {
    assert.equal(seen(nested), 'a.b.localhost', 'a nested name keeps its full context');
  }
  const deep = await call('whatever.localhost', '/anything/deep');
  assert.equal(seen(deep), 'whatever.localhost');
  assert.ok(String(seenPath(deep)).includes('anything'), 'the path is passed on');
  if (realMonad) {
    assert.equal(deep.status, 404, 'a path under a name is read in that name, and is empty there');
    const html = await call('whatever.localhost', '/', { accept: 'text/html' });
    assert.equal(html.status, 200);
    assert.match(html.text, /<title>whatever\.localhost<\/title>/, 'the shell carries the address, not the root');
  }

  // ── a name never reaches the gateway's admin surface, and never gets the root's panel ──
  const domains = await call('whatever.localhost', '/domains');
  assert.ok(!(domains.json && domains.json.success === true && Array.isArray(domains.json.domains)), 'GET /domains under a name is not the gateway\'s domain list');
  const write = await call('whatever.localhost', '/add-domain', { method: 'POST', body: { domain: 'x.test', type: 'server', target: '127.0.0.1:4000' } });
  assert.ok(realMonad ? write.status !== 200 : write.json?.rootStandIn === true, `POST /add-domain under a name is handed to the root, not to the admin API: ${write.status} ${write.text.slice(0, 120)}`);
  assert.equal(((await call('127.0.0.1', '/domains')).json?.domains ?? []).length, 0, 'and nothing was created');

  // ── 1. a declared route wins; removing it returns the name to the root's attendance ──
  fs.writeFileSync(mapPath, JSON.stringify({ version: 1, domains: { 'camiones.localhost': { type: 'server', target: `127.0.0.1:${svcPort}`, protocol: 'http', ssl: { enabled: false } } } }));
  const declared = await call('camiones.localhost', '/', { accept: 'text/html' });
  assert.equal(declared.status, 200);
  assert.equal(declared.text, 'servicio-declarado', 'a declared name is its destination');
  assert.equal(seen(await call('otro.localhost', '/')), 'otro.localhost', 'an undeclared sibling is still attended by the root');
  fs.writeFileSync(mapPath, JSON.stringify({ version: 1, domains: {} }));
  assert.equal(seen(await call('camiones.localhost', '/')), 'camiones.localhost', 'undeclared again');

  // ── 3. nobody is root: the neutral shell; nothing asserted, nothing created ──
  const apps = registry();
  const withoutRoot = JSON.parse(JSON.stringify(apps));
  // every registration that IS the root (the helper registers the gateway's monad and the surface entry for `localhost`)
  for (const [k, a] of Object.entries<any>(withoutRoot.apps)) if (a?.metadata?.namespace === 'localhost') delete withoutRoot.apps[k];
  fs.writeFileSync(appsPath, JSON.stringify(withoutRoot));
  const before = snapshot();
  const shell = await call('whatever.localhost', '/', { accept: 'text/html' });
  assert.equal(shell.status, 404);
  assert.match(shell.text, /Sin contenido disponible para esta dirección/);
  assert.ok(!/reclam|claim|no existe|not exist/i.test(shell.text), 'it says nothing about claims or existence');
  const shellJson = await call('whatever.localhost', '/', { accept: 'application/json' });
  assert.equal(shellJson.status, 404);
  assert.equal(shellJson.json?.error, 'no_content_available');
  assert.deepEqual(snapshot(), before, 'visiting wrote nothing');
  // the root is registered but not live: a state of the machine (503), not "no content"
  const stale = JSON.parse(JSON.stringify(apps));
  for (const a of Object.values<any>(stale.apps)) if (a?.metadata?.namespace === 'localhost') { a.lastSeenMs = Date.now() - 24 * 3600_000 * 2; a.ttlMs = 12_000; }
  fs.writeFileSync(appsPath, JSON.stringify(stale));
  assert.equal((await call('whatever.localhost', '/')).status, 503, 'a root that is not live is unavailable, not empty');
  fs.writeFileSync(appsPath, JSON.stringify(apps));
  assert.equal((await call('whatever.localhost', '/')).status, 200, 'and attends again when it is back');

  // ── loopback peers only ──────────────────────────────────────────────────────
  if (lanIp) {
    const peer = await call('whatever.localhost', '/', { via: lanIp });
    assert.equal(peer.status, 403, `a peer that is not loopback does not get a name under .localhost (via ${lanIp})`);
  } else {
    console.log('named-spaces-localhost: no LAN address on this machine; the non-loopback check was skipped');
  }

  // ── the machine's own gateway was not touched ───────────────────────────────
  assert.equal(fs.existsSync(REAL_MAP) ? fs.statSync(REAL_MAP).mtimeMs : null, realBefore, "the machine's own domain-map.json was not written");
} finally {
  service?.close();
  rootStandIn?.close();
  if (ng) await ng.stop();
  await be.stop();
}
console.log('named-spaces-localhost: ok');
process.exit(0);
