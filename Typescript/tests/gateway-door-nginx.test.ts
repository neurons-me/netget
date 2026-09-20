import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The door, end to end on a disposable OpenResty: the REAL generated nginx.conf and
// netget_app.conf and the REAL Lua, in a temp prefix on high ports, in front of a REAL monad
// with the gateway module, over REAL TLS.
//
// The closing criterion: <door>/<path> and <namespace>/<path> resolve the same path of the same
// namespace, with the same authorization and disclosure -- the door's default app may differ,
// but nothing may sit in front of the tree. Also: a door that is not (or no longer) declared
// gets nothing; an unreadable state file keeps the last good one; the old door keeps working
// while the new one is added; and probeMainServer, asked of the real nginx over TLS, agrees.
//
// Everything is temp: HOME, the data dir, the certificates, the prefix. The only listeners are
// 127.0.0.1 ports this test picks.

if (!fs.existsSync('/opt/homebrew/bin/openresty') && !fs.existsSync('/usr/local/bin/openresty') && !fs.existsSync('/usr/bin/openresty')) {
  console.log('gateway-door-nginx.test.ts: skipped (no openresty on this machine)');
  process.exit(0);
}
const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p))!;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-door-'));
const home = path.join(tmp, 'home');
const dataDir = path.join(tmp, 'data');
const leDir = path.join(tmp, 'letsencrypt-live');
const prefix = path.join(tmp, 'or');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>STATIC PANEL</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home;
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = leDir;
process.env.NETGET_MONAD_NAMESPACE = 'cleaker.test';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;

// One certificate for every name this test serves, trusted by this test's clients only.
const certDir = path.join(tmp, 'cert'); fs.mkdirSync(certDir);
const keyFile = path.join(certDir, 'privkey.pem'); const crtFile = path.join(certDir, 'fullchain.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', '2',
  '-subj', '/CN=cleaker.test', '-addext', 'subjectAltName=DNS:cleaker.test,DNS:*.cleaker.test,DNS:netget.test,DNS:door2.test,DNS:evil.test'], { stdio: 'ignore' });
const ca = fs.readFileSync(crtFile);
for (const name of ['cleaker.test', 'netget.test']) {
  fs.mkdirSync(path.join(leDir, name), { recursive: true });
  fs.copyFileSync(crtFile, path.join(leDir, name, 'fullchain.pem'));
  fs.copyFileSync(keyFile, path.join(leDir, name, 'privkey.pem'));
}
// the panel's placeholder certificate (what the generated conf names for its default server)
fs.mkdirSync(path.join(home, '.netget', 'certs'), { recursive: true });
fs.copyFileSync(crtFile, path.join(home, '.netget', 'certs', 'local.netget.pem'));
fs.copyFileSync(keyFile, path.join(home, '.netget', 'certs', 'local.netget-key.pem'));
// a door whose certificate is NOT in the letsencrypt dir: no server block of its own, so the default server routes it
const door2Certs = { certificate: path.join(certDir, 'fullchain.pem'), key: path.join(certDir, 'privkey.pem') };

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const HTTPS_PORT = await freePort();
const HTTP_PORT = await freePort();

// ── the monad, with the gateway module, declaring its main server ───────────
const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad'); fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'door-nginx-test-seed', namespace: 'cleaker.test',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'cleaker.test', selfHostname: 'cleaker.test', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'],
  port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'),
  modules: [modulePath], mainServerName: 'netget.test', logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad: import('node:http').Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const monadPort = (monad.address() as any).port;
process.env.NETGET_MONAD_ORIGIN = `http://127.0.0.1:${monadPort}`;
const internal = { 'x-monad-internal-token': process.env.MONAD_INTERNAL_TOKEN! };

const {
  reconcileMainServer, defaultMainServerDeps, writeMainServerState, readMainServerState, getMainServerStatePath, probeMainServer,
} = await import('../src/gateway/mainServerEntry.ts');
const { generateDomainMap } = await import('../src/runtime/domainMap.ts');
let openresty: import('node:child_process').ChildProcess | null = null;
const stopOpenresty = () => { try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { /* not running */ } };

try {
  // the namespace's own domain, and the derived door for what it declares
  const addDomain = (body: unknown) => fetch(`${process.env.NETGET_MONAD_ORIGIN}/add-domain`, { method: 'POST', headers: { 'content-type': 'application/json', ...internal }, body: JSON.stringify(body) });
  assert.equal((await addDomain({ domain: 'cleaker.test', type: 'proxy', owner: 'netget', sslMode: 'letsencrypt', sslCertificate: path.join(leDir, 'cleaker.test', 'fullchain.pem'), sslCertificateKey: path.join(leDir, 'cleaker.test', 'privkey.pem') })).status, 200);
  const deps = await defaultMainServerDeps();
  deps.probe = async () => ({ reachable: 'ok' }); // asked of the real nginx further down
  const derived = await reconcileMainServer(deps);
  assert.equal(derived.declared.status, 'valid'); assert.equal(derived.active, 'netget.test');
  // a second door, whose certificate is only in the routing table (default-server path), while the name is "changing"
  assert.equal((await addDomain({ domain: 'door2.test', type: 'main_server', owner: 'netget', sslMode: 'manual', sslCertificate: door2Certs.certificate, sslCertificateKey: door2Certs.key })).status, 200);
  const twoDoors = { ...derived, doors: [...derived.doors, { name: 'door2.test', tls: 'present' as const, reachable: 'unchecked' as const }] };
  writeMainServerState(twoDoors);
  await generateDomainMap();
  // the namespace's monad, as the mesh registry knows it
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
    apps: { monad: { name: 'netget', ttlMs: 3_600_000, lastSeenMs: Date.now(), trust: 'owner',
      metadata: { namespace: 'cleaker.test', endpoint: `http://127.0.0.1:${monadPort}`, identityHash: 'x' } } },
  }));

  // ── the REAL generated configuration, in a temp prefix ───────────────────
  const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
  const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
  const layout: any = {
    layoutKey: 'linux-source', configDir: path.join(prefix, 'conf'), confDDir: path.join(prefix, 'conf.d'), logDir: path.join(prefix, 'logs'),
    configFilePath: path.join(prefix, 'conf', 'nginx.conf'), luaDir: path.join(prefix, 'lua'),
    luaPackagePath: `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;;`, userDirective: '', isSupported: true,
  };
  const highPorts = (conf: string) => conf
    .replace(/^\s*listen \[::\]:\d+.*;\n/gm, '')
    .replace(/listen 80( default_server)?;/g, `listen ${HTTP_PORT}$1;`)
    .replace(/listen 443 ssl( default_server)?;/g, `listen ${HTTPS_PORT} ssl$1;`);
  fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), highPorts(buildNginxConfigContent(layout)).replace(/^env .*;\n/gm, '').replace(/^events \{/m, `pid ${path.join(prefix, 'logs', 'nginx.pid')};\nenv NETGET_DATA_DIR;\nevents {`));
  fs.writeFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), highPorts(getNetgetAppConfContent(layout)));
  fs.copyFileSync('/opt/homebrew/etc/openresty/mime.types', path.join(prefix, 'conf', 'mime.types'));
  fs.cpSync(path.resolve(here, '../src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

  const generated = fs.readFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), 'utf8');
  assert.match(generated, /server_name [^;]*\bnetget\.test\b/, 'the door has a server block of its own (its certificate is in the letsencrypt dir)');
  assert.doesNotMatch(generated, /# netget\.test → Main Server dashboard/, 'the derived door is not the dashboard block any more');
  assert.doesNotMatch(generated, /server_name [^;]*\bdoor2\.test\b/, 'a door without a certificate in the letsencrypt dir is served by the default server');

  const test = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: { ...process.env, NETGET_DATA_DIR: dataDir } });
  let testOut = ''; test.stderr.on('data', (d) => { testOut += d; }); test.stdout.on('data', (d) => { testOut += d; });
  const testCode: number = await new Promise((r) => test.on('close', r));
  assert.equal(testCode, 0, `openresty -t failed:\n${testOut}`);
  openresty = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: { ...process.env, NETGET_DATA_DIR: dataDir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    if (await new Promise<boolean>((r) => { const c = net.connect(HTTPS_PORT, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); })) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // ── client: any host, over real TLS to the disposable nginx ──────────────
  type Res = { status: number; headers: Record<string, any>; text: string; json: any };
  const call = (host: string, method: string, p: string, o: { headers?: Record<string, string>; body?: unknown; sni?: string } = {}): Promise<Res> =>
    new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: HTTPS_PORT, servername: o.sni ?? host, method, path: p, ca, timeout: 8000,
        headers: { host, accept: 'application/json', ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) } }, (res) => {
        let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
        res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode!, headers: res.headers, text, json }); });
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${host}${p}`)));
      if (o.body !== undefined) req.write(JSON.stringify(o.body));
      req.end();
    });
  // the address (host) the request came through is transport; everything else must be the same
  const canon = (r: Res) => {
    const j = r.json ? JSON.parse(JSON.stringify(r.json)) : r.text;
    if (j?.target?.namespace) delete j.target.namespace.host;
    return { status: r.status, body: j };
  };
  const NS = 'cleaker.test'; const DOOR = 'netget.test'; const DOOR2 = 'door2.test';
  const same = async (label: string, method: string, p: string, o: { headers?: Record<string, string>; body?: unknown } = {}, expectStatus?: number) => {
    const a = canon(await call(NS, method, p, o));
    for (const door of [DOOR, DOOR2]) {
      const b = canon(await call(door, method, p, o));
      assert.deepEqual(b, a, `${label}: ${door}${p} must be what ${NS}${p} is`);
    }
    if (expectStatus !== undefined) assert.equal(a.status, expectStatus, `${label}: status`);
    return a;
  };

  // ── 1. the same path of the same namespace, from every door ──────────────
  const declared = await same('the declaration', 'GET', '/netget.main.server.name', {}, 200);
  assert.equal(declared.body.target.value, 'netget.test'); assert.equal(declared.body.target.namespace.me, 'cleaker.test'); assert.equal(declared.body.disclosure, 'public');
  await same('an absent path', 'GET', '/no.such.path', {}, 404);
  { // the root is a live ledger (its blocks change between two reads): same answer in kind, same namespace
    const shape = (r: Res) => ({ status: r.status, keys: Object.keys(r.json ?? {}).sort(), namespace: r.json?.namespace ?? r.json?.target?.namespace?.me ?? null });
    const a = shape(await call(NS, 'GET', '/'));
    for (const door of [DOOR, DOOR2]) assert.deepEqual(shape(await call(door, 'GET', '/')), a, `${door}/ is what ${NS}/ is`);
    assert.equal(a.status, 200);
  }
  await same('the gateway\'s own routes', 'GET', '/domains', {}, 200);
  await same('a handle path', 'GET', '/@alice/profile.name', {});

  // ── 2. the same authorization ────────────────────────────────────────────
  const forbidden = await same('unsigned write to the reserved declaration', 'POST', '/', { body: { operation: 'write', expression: 'netget.main.server.name', value: 'evil.test' } }, 403);
  assert.equal(forbidden.body.error, 'GATEWAY_PATH_REQUIRES_GATEWAY_API');
  await same('unsigned write to the routing records', 'POST', '/', { body: { operation: 'write', expression: 'domains.evil__DOT__test.target', value: 'http://10.0.0.1:80' } }, 403);
  await same('anonymous add-domain', 'POST', '/add-domain', { body: { domain: 'evil.test', type: 'proxy', target: 'http://10.0.0.1:80' } }, 401);
  await same('anonymous gateway claim', 'POST', '/__gateway/claim', { body: { identityHash: 'a'.repeat(64), publicKey: 'A'.repeat(43) } }, 401);
  await same('anonymous openresty stop', 'POST', '/openresty-stop', { body: {} }, 401);
  // forged headers do not turn a door into a different namespace, nor the caller into an operator
  const baseline = canon(await call(NS, 'GET', '/netget.main.server.name'));
  for (const door of [NS, DOOR, DOOR2]) {
    const forged = canon(await call(door, 'GET', '/netget.main.server.name', { headers: { 'x-forwarded-host': 'evil.test', 'x-netget-identity': 'a'.repeat(64), 'x-netget-scopes': '["gateway:write"]' } }));
    assert.deepEqual(forged, baseline, `${door}: client-supplied forwarding/identity headers change nothing`);
  }
  assert.equal((await call(DOOR, 'POST', '/add-domain', { body: { domain: 'evil.test', type: 'proxy' }, headers: { 'x-netget-identity': 'a'.repeat(64), 'x-netget-scopes': '["gateway:write"]' } })).status, 401);

  // ── 3. the default app may differ; the tree is not behind it ─────────────
  for (const host of [NS, DOOR, DOOR2]) {
    const page = await call(host, 'GET', '/', { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200, `${host} html`);
    assert.match(String(page.headers['content-type']), /html/);
    assert.doesNotMatch(page.text, /STATIC PANEL/, `${host} is not the static panel any more`);
    assert.match(page.text, /cleaker\.test/, `${host}: the page boots into the namespace`);
  }

  // ── 4. what is not (or no longer) a door gets nothing ────────────────────
  // A name with no certificate cannot even complete the handshake; a name that borrows a valid
  // certificate (SNI of a real door) and asks for another Host reaches the default server, which
  // knows no such host.
  await assert.rejects(call('evil.test', 'GET', '/netget.main.server.name'), /handshake|EPROTO|alert/i);
  for (const headers of [{}, { 'x-forwarded-host': NS }, { 'x-forwarded-host': DOOR }] as Array<Record<string, string>>) {
    const r = await call('evil.test', 'GET', '/netget.main.server.name', { sni: DOOR, headers });
    assert.notEqual(r.json?.target?.value, 'netget.test', `evil.test ${JSON.stringify(headers)} does not reach the tree`);
    assert.ok(r.status === 404 || r.status === 503 || !r.json?.target, `evil.test: ${r.status}`);
  }

  // ── 5. availability, asked of the real nginx over TLS ────────────────────
  const viaNginx = { connectHost: '127.0.0.1', port: HTTPS_PORT, ca };
  assert.deepEqual(await probeMainServer(DOOR, viaNginx), { reachable: 'ok' });
  assert.deepEqual(await probeMainServer(DOOR2, viaNginx).then((r) => r.reachable), 'failing', 'door2 is a door, but the tree there declares netget.test, not door2.test');
  const notDoor = await probeMainServer('evil.test', viaNginx);
  assert.equal(notDoor.reachable, 'failing');

  // ── 6. the generated state is what decides, and it is never lost ─────────
  const statePath = getMainServerStatePath();
  const settle = () => new Promise((r) => setTimeout(r, 1300)); // workers re-read it once a second
  fs.writeFileSync(statePath, '{ this is not json'); await settle();
  assert.equal((await call(DOOR, 'GET', '/netget.main.server.name')).json.target.value, 'netget.test', 'an unreadable state keeps the last good one');
  assert.equal((await call(DOOR2, 'GET', '/netget.main.server.name')).json.target.value, 'netget.test', 'so does the other door');
  // the old door is retired only when the state says so
  writeMainServerState({ ...twoDoors, doors: twoDoors.doors.filter((d: any) => d.name !== DOOR2) }); await settle();
  const retired = await call(DOOR2, 'GET', '/netget.main.server.name');
  assert.ok(retired.status !== 200 || retired.json?.target?.value !== 'netget.test', `door2 is retired (${retired.status})`);
  assert.equal((await call(DOOR, 'GET', '/netget.main.server.name')).json.target.value, 'netget.test', 'the active door is untouched');
  assert.equal((await call(NS, 'GET', '/netget.main.server.name')).json.target.value, 'netget.test');
  assert.equal(readMainServerState()!.active, 'netget.test');
} finally {
  stopOpenresty();
  openresty?.kill();
  await new Promise((resolve) => monad.close(resolve));
  if (process.env.KEEP_DOOR_TEST_LOGS) console.log(`kept ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-door-nginx.test.ts: all assertions passed');
process.exit(0);
