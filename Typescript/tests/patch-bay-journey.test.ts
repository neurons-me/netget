import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// The patch bay's basic journey, on a disposable gateway built from the generator's own main nginx.conf (the router that
// serves a custom domain from domain-map.json), a real domain store (a disposable monad) and the gateway's real routes
// behind the same capability gate the monad-mounted gateway uses:
//
//   mount a static app, mount a service on a port  ->  point a domain at each  ->  open it  ->  change the destination
//   ->  the service goes away (a real error)  ->  disconnect  ->  not found.
//
// plus: who may do it (anonymous / a session without gateway:write / one with it) and a registered monad as a target.
// Nothing here touches the machine's gateway: its own prefix, ports, data dir and monad.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-journey-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<h1>panel</h1>');
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = `journey-${process.pid}.local`;
const TEST_MONAD_NAME = `journey-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;
delete process.env.NETGET_GATEWAY_UPSTREAM;

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('patch-bay-journey: skipped (no openresty on this machine)'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const { detectOpenRestyLayout } = await import('../src/modules/NetGetX/OpenResty/platformDetect.ts');
const { startNetgetMonad } = await import('../src/kernel/netgetMonadProcess.ts');
const { readMonadRecord, deleteMonadProcess } = await import('monad.ai');
const { createLocalNetgetTestApp } = await import('../src/htmls/Netget-REACT/backend/testHarness.mjs');

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });

// ── a disposable monad for the domain store (never the ambient one) ──────────────────────────────────────────────
const reserved = await reservePort();
const guard = installMonadOriginGuard([`http://127.0.0.1:${reserved}`]);
const started = await startNetgetMonad({ port: reserved });
assert.ok(started.running, `the disposable monad starts: ${started.message}`);
assert.equal((await readMonadRecord(TEST_MONAD_NAME))?.port, reserved, 'registered under its own name');

// ── upstreams: a static folder and two services ──────────────────────────────────────────────────────────────────
const staticA = path.join(tmp, 'static-a'); const staticB = path.join(tmp, 'static-b');
for (const [dir, mark] of [[staticA, 'STATIC-A'], [staticB, 'STATIC-B']] as const) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>${mark}</title><p>${mark}</p>`);
}
const service = (mark: string) => http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.end(`${mark} host=${req.headers.host} xfp=${req.headers['x-forwarded-proto']} path=${req.url}`);
});
const svc1 = service('SERVICE-1'); const svc2 = service('SERVICE-2');
const [svc1Port, svc2Port, p80, p443, apiPort] = [await freePort(), await freePort(), await freePort(), await freePort(), await freePort()];
await new Promise<void>((r) => svc1.listen(svc1Port, '127.0.0.1', () => r()));
await new Promise<void>((r) => svc2.listen(svc2Port, '127.0.0.1', () => r()));

// ── the gateway's routes behind the capability gate ──────────────────────────────────────────────────────────────
const gateApp = createLocalNetgetTestApp({ gate: {
  resolveSession: async (token: string) => token === 'admin' ? { identityHash: 'h-admin', scopes: ['gateway:write'] }
    : token === 'reader' ? { identityHash: 'h-reader', scopes: ['gateway:read'] } : null,
  isOwner: () => false,
} });
const api = http.createServer(gateApp);
await new Promise<void>((r) => api.listen(apiPort, '127.0.0.1', () => r()));
const call = (method: string, p: string, body?: unknown, token?: string) => new Promise<{ status: number; json: any }>((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: apiPort, path: p, method, headers: {
    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { let json: any = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, json }); });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

// ── a disposable OpenResty from the generator's main conf ────────────────────────────────────────────────────────
const layout = { ...detectOpenRestyLayout(), confDDir: path.join(tmp, 'conf.d'), logDir: path.join(tmp, 'logs'), configFilePath: path.join(tmp, 'nginx.conf') };
fs.mkdirSync(layout.confDDir, { recursive: true }); fs.mkdirSync(layout.logDir, { recursive: true });
const cert = path.join(tmp, 'cert.pem'); const key = path.join(tmp, 'key.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
let conf = buildNginxConfigContent(layout as any);
conf = conf
  .replace('listen 80 default_server;', `listen 127.0.0.1:${p80} default_server;`).replace(/\n\s*listen \[::\]:80 default_server;/, '')
  .replace('listen 443 ssl default_server;', `listen 127.0.0.1:${p443} ssl default_server;`).replace(/\n\s*listen \[::\]:443 ssl default_server;/, '')
  .replace(/ssl_certificate\s+[^;]+;/, `ssl_certificate ${cert};`).replace(/ssl_certificate_key\s+[^;]+;/, `ssl_certificate_key ${key};`)
  .replace(/^\s*user\s+[^;]+;\s*$/m, '')
  // the repo's lua/ first: the policy library (lib/door_connections.lua) is not installed on this machine, and this test
  // must not install it
  .replace(/lua_package_path "/, `lua_package_path "${path.resolve('src/modules/NetGetX/OpenResty/lua')}/?.lua;`)
  // and a listener on this machine's LAN address: a peer that is not loopback
  .replace(/listen 127\.0\.0\.1:\d+ ssl default_server;/, (m) => (lanIp ? `${m}\n        listen ${lanIp}:${p443} ssl default_server;` : m));
const confPath = path.join(tmp, 'nginx.conf');
fs.writeFileSync(confPath, conf);
fs.writeFileSync(path.join(tmp, 'mime.types'), 'types { text/html html htm; text/css css; application/javascript js; text/plain txt; }\n');
const gArgs = ['-p', tmp, '-c', confPath, '-g', `pid ${path.join(tmp, 'nginx.pid')};`];
execFileSync(openrestyBin, ['-t', ...gArgs], { stdio: 'pipe' });
const nginx = spawn(openrestyBin, [...gArgs.slice(0, -1), `pid ${path.join(tmp, 'nginx.pid')}; daemon off;`], { stdio: 'ignore', env: { ...process.env, NETGET_DATA_DIR: dataDir } });
const up = () => new Promise<boolean>((r) => { const c = net.connect(p443, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
for (let i = 0; i < 60 && !(await up()); i += 1) await new Promise((r) => setTimeout(r, 100));
assert.ok(await up(), 'the disposable gateway is up');

// no TLS session reuse and no keep-alive: every open() is a full handshake against the router's CURRENT map
const agent = new https.Agent({ maxCachedSessions: 0, keepAlive: false });
type Res = { status: number; type: string; body: string };
const open = (host: string, { port = p443, tls = true, pathname = '/', via = '127.0.0.1', headers = {} as Record<string, string> } = {}) => new Promise<Res>((resolve, reject) => {
  const mod: any = tls ? https : http;
  const req = mod.request({ host: via, port, path: pathname, method: 'GET', headers: { Host: host, Accept: 'text/html', ...headers }, ...(tls ? { servername: host, rejectUnauthorized: false, agent } : { agent: false }) }, (res: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.end();
});
const handshakeFails = (host: string) => open(host).then(() => false, (e: any) => /handshake failure|EPROTO|ECONNRESET|alert/i.test(String(e?.message ?? e)));
// the gateway re-reads domain-map.json on a 1 s timer after the version file changes
async function until(host: string, pred: (r: Res) => boolean, what: string, opts = {}) {
  let last: Res | null = null;
  let lastError = '';
  for (let i = 0; i < 60; i += 1) {
    try {
      last = await open(host, opts);
      if (pred(last)) return last;
    } catch (error: any) {
      lastError = String(error?.message ?? error).slice(0, 120); // e.g. a handshake before the map is reloaded
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`${what}: last answer was ${last?.status} ${String(last?.body).slice(0, 160)} ${lastError}`);
}

try {
  // 0. nothing is mounted: a host that is not in the map cannot complete a TLS handshake on this router (no page: the
  //    router clears the default certificate and has none to put in its place). Recorded as it is.
  assert.equal(await handshakeFails('nothing-here.test'), true, 'an unregistered domain over HTTPS: handshake failure');
  // and over plain HTTP the default server answers with its own page, whatever the host is
  const plain = await open('nothing-here.test', { port: p80, tls: false });
  assert.equal(plain.status, 200);
  assert.match(plain.body, /Netget Gateway|gateway|netget/i);

  // 1. who may change the gateway
  // A route is served over TLS with ITS certificate (sslCertificate/sslCertificateKey of the record); a host with none
  // cannot complete a handshake on this router (see step 0), so the doors of this journey carry the test's own pair.
  const add = (domain: string, type: string, target: string, token?: string) =>
    call('POST', '/add-domain', { domain, type, target, owner: 'journey', sslMode: 'manual', sslCertificate: cert, sslCertificateKey: key }, token);
  assert.equal((await add('static-app.test', 'static', staticA)).status, 401, 'anonymous: ADMIN_SESSION_REQUIRED');
  const denied = await add('static-app.test', 'static', staticA, 'reader');
  assert.equal(denied.status, 403, 'a session without gateway:write');
  assert.equal(denied.json?.error, 'CAPABILITY_DENIED');
  assert.equal((await add('static-app.test', 'static', staticA, 'not-a-session')).status, 401, 'an unknown token');
  assert.equal((await call('GET', '/domains')).status, 200, 'listing the domains is public...');
  assert.deepEqual((await call('GET', '/domains')).json?.domains ?? [], [], '...and nothing was added by the refused calls');

  // 2. mount a static app and point a domain at it; open it
  assert.equal((await add('static-app.test', 'static', staticA, 'admin')).json?.success, true);
  const a = await until('static-app.test', (r) => r.status === 200 && r.body.includes('STATIC-A'), 'the static app opens');
  assert.match(a.type, /text\/html/);

  // 3. mount a service on a port; point a domain at it; open it
  assert.equal((await add('service-app.test', 'server', `127.0.0.1:${svc1Port}`, 'admin')).json?.success, true);
  const s1 = await until('service-app.test', (r) => r.status === 200 && r.body.includes('SERVICE-1'), 'the service opens');
  assert.match(s1.body, /host=service-app\.test/, 'the service sees the domain the visitor used');
  assert.match(s1.body, /xfp=https/);

  // 4. change the destination (no new domain, nothing copied): the service, then the static app of the other folder
  assert.equal((await call('POST', '/update-domain', { domain: 'service-app.test', updatedFields: { target: `127.0.0.1:${svc2Port}` } }, 'admin')).json?.success, true);
  await until('service-app.test', (r) => r.status === 200 && r.body.includes('SERVICE-2'), 'the same domain now answers from the second service');
  assert.equal((await call('POST', '/update-domain', { domain: 'static-app.test', updatedFields: { target: staticB } }, 'admin')).json?.success, true);
  await until('static-app.test', (r) => r.body.includes('STATIC-B'), 'the static domain now serves the other folder');
  const kind = await call('POST', '/update-domain', { domain: 'service-app.test', updatedFields: { type: 'static', target: staticA } }, 'admin');
  assert.equal(kind.json?.success, true);
  await until('service-app.test', (r) => r.body.includes('STATIC-A'), 'a domain can switch from a service to files');
  assert.equal((await call('POST', '/update-domain', { domain: 'service-app.test', updatedFields: { type: 'server', target: `127.0.0.1:${svc2Port}` } }, 'admin')).json?.success, true);
  await until('service-app.test', (r) => r.body.includes('SERVICE-2'), 'and back');

  // 5. a real error: the service goes away. The visitor gets the gateway's page for it (503, with what it was pointed at)
  await new Promise<void>((r) => svc2.close(() => r()));
  const down = await until('service-app.test', (r) => r.status === 503, 'a dead service is 503');
  assert.match(down.type, /text\/html/);
  assert.match(down.body, new RegExp(String(svc2Port)), 'the page says what the domain is pointed at');
  assert.equal((await open('static-app.test')).status, 200, 'the other domain is not affected');

  // 6. a registered app (a monad that reported itself) as the target: `app:<name>`
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { m: {
    name: 'monad:demo', kind: 'monad', host: '127.0.0.1', port: svc1Port, ttlMs: 600000, lastSeenMs: Date.now(), trust: 'peer',
    metadata: { monadName: 'demo', endpoint: `http://127.0.0.1:${svc1Port}` },
  } } }));
  assert.equal((await add('registered-app.test', 'server', 'app:demo', 'admin')).json?.success, true);
  const reg = await until('registered-app.test', (r) => r.status === 200 || r.status === 503, 'an app: target answers');
  assert.equal(reg.status, 200, `a monad registered as monad:demo is found by app:demo (got ${reg.status}: ${reg.body.slice(0, 120)})`);
  assert.match(reg.body, /SERVICE-1/);

  // 6a. an APP entry (kind "app": what `netget attach` / netget() list) as the target: the domain follows the policy the app
  //     declared -- an app that declared nothing is open to a loopback visitor and to no other address, a disabled one is 404
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { 'app:site': {
    id: 'app:site', name: 'site', kind: 'app', host: '127.0.0.1', port: svc1Port, ttlMs: 600000, lastSeenMs: Date.now(), trust: 'guest', metadata: { title: 'Site' },
  } } }));
  assert.equal((await add('app-entry.test', 'server', 'app:site', 'admin')).json?.success, true);
  const appEntryRes = await until('app-entry.test', (r) => r.status === 200 || r.status === 403 || r.status === 503, 'an app: target that is an APP entry answers');
  assert.equal(appEntryRes.status, 200, `an app entry with no policy opens for a loopback visitor (got ${appEntryRes.status}: ${appEntryRes.body.slice(0, 120)})`);
  assert.match(appEntryRes.body, /SERVICE-1/);
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { 'app:site': {
    id: 'app:site', name: 'site', kind: 'app', host: '127.0.0.1', port: svc1Port, ttlMs: 600000, lastSeenMs: Date.now(), trust: 'guest', exposure: { enabled: false },
  } } }));
  assert.equal((await open('app-entry.test')).status, 404, 'an app entry that declared itself disabled: 404');
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { m: {
    name: 'monad:demo', kind: 'monad', host: '127.0.0.1', port: svc1Port, ttlMs: 600000, lastSeenMs: Date.now(), trust: 'peer',
    metadata: { monadName: 'demo', endpoint: `http://127.0.0.1:${svc1Port}` },
  } } }));

  // 6a'. neurons.me: its built .GUI app (a single-page app, site.json: type static, spa true) as a folder of files
  const neuronsDist = process.env.NEURONS_DIST || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../apps/neurons.me/dist');
  if (fs.existsSync(path.join(neuronsDist, 'index.html'))) {
    const served = path.join(tmp, 'neurons-dist');
    fs.cpSync(neuronsDist, served, { recursive: true });
    const asset = fs.readdirSync(path.join(served, 'assets')).find((f) => f.endsWith('.css')) as string;
    assert.equal((await add('neurons.me', 'static', served, 'admin')).json?.success, true);
    const root = await until('neurons.me', (r) => r.status === 200 && /<div id="root"|<script/.test(r.body), 'neurons.me opens its index');
    assert.match(root.type, /text\/html/);
    const deep = await open('neurons.me', { pathname: '/some/deep/route' });
    assert.equal(deep.status, 200, 'a deep route is answered with the app (single-page fallback)');
    assert.equal(deep.body, root.body, 'and it is the same index.html');
    const css = await open('neurons.me', { pathname: `/assets/${asset}`, headers: { Accept: '*/*' } });
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/, 'a real asset keeps its own type (it is not replaced by the index)');
    assert.equal((await open('neurons.me', { pathname: '/assets/../../etc/passwd' })).body.includes('root:'), false, 'a path out of the folder serves nothing outside it');
    console.log('  neurons.me (static, SPA): / , a deep route and a real asset behave');
    assert.equal((await call('POST', '/delete-domain', { domain: 'neurons.me' }, 'admin')).json?.success, true);
  } else {
    console.log('  neurons.me dist not built here: that part of the journey is skipped');
  }

  // 6b. what a route may point at: ONE definition, refused with a code and a reason, whichever door writes it
  const refused = async (domain: string, type: string, target: string, code: string) => {
    const r = await add(domain, type, target, 'admin');
    assert.equal(r.status, 400, `${type} ${target} is refused`);
    assert.equal(r.json?.code, code, `${type} ${target}: ${JSON.stringify(r.json)}`);
  };
  await refused('bad-1.test', 'server', '127.0.0.1:3000', 'GATEWAY_PORT');
  await refused('bad-2.test', 'server', `127.0.0.1:${svc1Port}`, 'REGISTERED_APP_PORT');
  await refused('bad-3.test', 'server', 'https://127.0.0.1:4000', 'UPSTREAM_TLS');
  await refused('bad-4.test', 'server', '169.254.169.254:80', 'LINK_LOCAL');
  await refused('bad-5.test', 'static', 'relative/dir', 'STATIC_NOT_ABSOLUTE');
  await refused('bad-6.test', 'server', 'app:bad name', 'APP_NAME');
  await refused('bad-7.test', 'weird', '127.0.0.1:4000', 'TYPE');
  assert.equal((await add('lan-service.test', 'server', 'raspberrypi.local:8080', 'admin')).json?.success, true, 'another machine on the network is a destination');
  const refusedUpdate = await call('POST', '/update-domain', { domain: 'service-app.test', updatedFields: { target: '127.0.0.1:443' } }, 'admin');
  assert.equal(refusedUpdate.status, 400, 'changing a destination is checked too');
  assert.equal(refusedUpdate.json?.code, 'GATEWAY_PORT');
  assert.equal((await call('POST', '/update-domain', { domain: 'never-registered.test', updatedFields: { target: '127.0.0.1:4000' } }, 'admin')).status, 404);
  // the same rules at the store, so `netget routing` and any other writer get the same answer
  const { updateDomainRoute } = await import('../src/kernel/domainStore.ts');
  await assert.rejects(updateDomainRoute('service-app.test', 'server', '127.0.0.1:80'), (e: any) => e.name === 'RouteTargetError' && e.code === 'GATEWAY_PORT');
  assert.equal((await call('GET', '/domains')).json?.domains?.some((d: any) => d.domain.startsWith('bad-')), false, 'nothing was written by the refused calls');

  // 6c. the state of each door, from the gateway (admin-only; "unknown" is a state)
  assert.equal((await call('GET', '/domains/status')).status, 401, 'anonymous cannot probe destinations');
  assert.equal((await call('GET', '/domains/status', undefined, 'reader')).status, 403);
  // a door with no certificate: TLS pending, no address that can open
  assert.equal((await call('POST', '/add-domain', { domain: 'no-cert.test', type: 'server', target: `127.0.0.1:${svc1Port + 0}`.replace(String(svc1Port), String(await freePort())), owner: 'journey' }, 'admin')).json?.success, true);
  const st = (await call('GET', '/domains/status', undefined, 'admin')).json?.statuses as any[];
  const by = (d: string) => st.find((x) => x.domain === d);
  assert.equal(by('registered-app.test').destination.state, 'ok', 'app: a live registered app');
  assert.equal(by('registered-app.test').tls.state, 'configured');
  assert.equal(by('registered-app.test').open.url, 'https://registered-app.test/');
  assert.equal(by('service-app.test').destination.state, 'down', 'the service that was stopped');
  assert.equal(by('service-app.test').applied, true);
  assert.equal(by('static-app.test').destination.state, 'ok');
  assert.equal(by('no-cert.test').tls.state, 'pending');
  assert.equal(by('no-cert.test').open.url, null, 'TLS pending: no address is offered');
  assert.equal(by('no-cert.test').open.why, 'TLS pendiente');
  assert.equal(by('no-cert.test').destination.state, 'down', 'and its (made-up) destination does not answer');

  // 6d. a domain is one more way in to an app, not a way around what the app declared
  const appEntry = (patch: Record<string, unknown>) => fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { m: {
    name: 'monad:demo', kind: 'monad', host: '127.0.0.1', port: svc1Port, ttlMs: 600000, lastSeenMs: Date.now(), trust: 'peer',
    metadata: { monadName: 'demo' }, ...patch,
  } } }));
  const readBody = (r: Res) => r.body.slice(0, 140);
  if (lanIp) {
    appEntry({ exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true, allowLan: false, allowWan: false } } });
    const local = await open('registered-app.test');
    assert.equal(local.status, 200, `a loopback peer reaches an app whose policy keeps it on this machine (${readBody(local)})`);
    const lan = await open('registered-app.test', { via: lanIp });
    assert.equal(lan.status, 403, `a LAN peer does not: the domain does not widen the app's policy (${readBody(lan)})`);
    assert.match(lan.body, /app_not_exposed/);
    appEntry({ exposure: { enabled: true, visibility: 'lan', network: { allowLoopback: true, allowLan: true, allowWan: false } } });
    assert.equal((await open('registered-app.test', { via: lanIp })).status, 200, 'once the OPERATOR widened the app to the LAN, the LAN peer is served');
    appEntry({ exposure: { enabled: false } });
    assert.equal((await open('registered-app.test')).status, 404, 'a disabled app is not served through a domain either');
    appEntry({ trust: 'guest', exposure: { enabled: true, visibility: 'wan', network: { allowWan: true } } });
    assert.equal((await open('registered-app.test')).status, 403, 'a guest-trust app is not published by a domain');
  } else {
    console.log('patch-bay-journey: no non-loopback IPv4 here; the LAN-peer cases are skipped');
  }
  appEntry({});

  // 6e. what a service receives from a domain: the real peer, and nothing the gateway trusts from itself
  const echo = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.headers)); });
  const echoPort = await freePort();
  await new Promise<void>((r) => echo.listen(echoPort, '127.0.0.1', () => r()));
  assert.equal((await add('echo-app.test', 'server', `127.0.0.1:${echoPort}`, 'admin')).json?.success, true);
  const seen = await until('echo-app.test', (r) => r.status === 200 && r.body.startsWith('{'), 'the echo service opens', {
    headers: { 'X-Forwarded-For': '1.2.3.4', 'X-NetGet-Identity': 'someone-else', 'X-Netget-Scopes': 'gateway:write', 'X-Me-Proof': 'p', 'X-Monad-Internal-Token': 't', 'X-NetGet-Internal': '1' },
  });
  const got = JSON.parse(seen.body);
  assert.equal(got['x-forwarded-for'], '127.0.0.1', 'X-Forwarded-For is the peer, replaced');
  for (const h of ['x-netget-identity', 'x-netget-scopes', 'x-me-proof', 'x-monad-internal-token', 'x-netget-internal']) assert.equal(got[h], undefined, `${h} does not reach the service`);
  echo.close();

  // 7. disconnect: the door goes away; the app and its files are not touched
  assert.equal((await call('POST', '/delete-domain', { domain: 'static-app.test' }, 'reader')).status, 403, 'a session without gateway:write cannot disconnect');
  assert.equal((await call('POST', '/delete-domain', { domain: 'static-app.test' }, 'admin')).json?.success, true);
  for (let i = 0; i < 60 && !(await handshakeFails('static-app.test')); i += 1) await new Promise((r) => setTimeout(r, 200));
  const mapNow = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime', 'domain-map.json'), 'utf8')).domains;
  const listedNow = (await call('GET', '/domains')).json?.domains ?? [];
  assert.equal(
    await handshakeFails('static-app.test'), true,
    `a disconnected domain no longer completes a handshake (map has: ${Object.keys(mapNow).join(',')}; /domains lists: ${listedNow.map((d: any) => d.domain).join(',')})`,
  );
  assert.ok(fs.existsSync(path.join(staticA, 'index.html')) && fs.existsSync(path.join(staticB, 'index.html')), 'the files are still there');
  assert.equal((await call('POST', '/delete-domain', { domain: 'static-app.test' }, 'admin')).status, 404, 'disconnecting twice says so');
  const listed = (await call('GET', '/domains')).json?.domains ?? [];
  assert.ok(!listed.some((d: any) => d.domain === 'static-app.test'), 'and it is not listed');

  console.log('patch-bay-journey: ok');
} finally {
  nginx.kill(); api.close(); svc1.close(); svc2.close();
  guard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
