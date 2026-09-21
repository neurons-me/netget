import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Who may reach the gateway's control actions THROUGH NGINX, on a disposable OpenResty (the real
// generated confs and Lua) in front of a real monad with the gateway module.
//
// Three things a header or a scheme does not prove, and this checks each one:
//   * "Host: localhost" says nothing about the client. The same request is sent twice: from
//     127.0.0.1 (a process on this machine) and from this machine's LAN address (a different peer
//     address, same Host). Only the first may change or stop anything.
//   * "Plain HTTP means local development" is not a credential: the LAN client over HTTP gets nothing.
//   * A cookie or a JWT is not a credential: nothing in the gateway issues one, so nothing may accept one.
//     (An older version verified a JWT with a built-in "dev_secret", and /logs accepted ANY cookie named
//     "token".) A forged token, a token signed with a real secret and a bare cookie all get nothing.
// And the monad's internal credential must never get through nginx: a request that carries the REAL
// token, sent through nginx, is refused; the same request sent to the monad directly is accepted.
//
// Everything is temp: HOME, the data dir, certificates, the prefix; a stand-in `netget` on PATH records
// whether anything ran it. The only listeners are ports this test picks.

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('gateway-edge-access.test.ts: skipped (no openresty on this machine)'); process.exit(0); }
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-edge-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
const stubDir = path.join(tmp, 'bin'); fs.mkdirSync(stubDir);
const ranLog = path.join(tmp, 'netget-ran.log');
fs.writeFileSync(path.join(stubDir, 'netget'), `#!/bin/sh\necho "$@" >> "${ranLog}"\necho '{"ok":true,"stub":true}'\n`, { mode: 0o755 });
const ran = () => (fs.existsSync(ranLog) ? fs.readFileSync(ranLog, 'utf8').trim().split('\n').filter(Boolean) : []);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'edge-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN; delete process.env.JWT_SECRET;

const certDir = path.join(tmp, 'cert'); fs.mkdirSync(certDir);
const keyFile = path.join(certDir, 'k.pem'); const crtFile = path.join(certDir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', '2', '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost,DNS:local.netget,IP:127.0.0.1'], { stdio: 'ignore' });
fs.mkdirSync(path.join(home, '.netget', 'certs'), { recursive: true });
fs.copyFileSync(crtFile, path.join(home, '.netget', 'certs', 'local.netget.pem'));
fs.copyFileSync(keyFile, path.join(home, '.netget', 'certs', 'local.netget-key.pem'));

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const HTTP_PORT = await freePort(); const HTTPS_PORT = await freePort();

// ── a real monad with the gateway module ────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad'); fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'edge-access-test-seed', namespace: 'edge-test.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'edge-test.me', selfHostname: 'edge-test.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const monadOrigin = `http://127.0.0.1:${(monad.address() as any).port}`;
process.env.NETGET_MONAD_ORIGIN = monadOrigin;
process.env.NETGET_GATEWAY_UPSTREAM = monadOrigin;
const TOKEN = process.env.MONAD_INTERNAL_TOKEN!;
assert.match(TOKEN, /^[0-9a-f]{64}$/);

// ── the real generated configuration in a temp prefix ───────────────────────
const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
const layout: any = {
  layoutKey: 'linux-source', configDir: path.join(prefix, 'conf'), confDDir: path.join(prefix, 'conf.d'), logDir: path.join(prefix, 'logs'),
  configFilePath: path.join(prefix, 'conf', 'nginx.conf'), luaDir: path.join(prefix, 'lua'),
  // lua-resty-jwt / lua-resty-cookie live in the site lualib tree, as in the real layout
  luaPackagePath: `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;/opt/homebrew/opt/openresty/site/lualib/?.lua;/opt/homebrew/opt/openresty/site/lualib/?/init.lua;;`, userDirective: '', isSupported: true,
};
const highPorts = (conf: string) => conf
  .replace(/^\s*listen \[::\]:\d+.*;\n/gm, '')
  .replace(/listen 80( default_server)?;/g, `listen ${HTTP_PORT}$1;`)
  .replace(/listen 443 ssl( default_server)?;/g, `listen ${HTTPS_PORT} ssl$1;`);
// the machine's own address is one of the names the admin block answers to (xConfig.localIP / publicIP)
if (lan) fs.writeFileSync(path.join(dataDir, 'xConfig.json'), JSON.stringify({ localIP: lan }));
const appConf = getNetgetAppConfContent(layout);
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), highPorts(buildNginxConfigContent(layout)).replace(/^events \{/m, `pid ${path.join(prefix, 'logs', 'nginx.pid')};\nevents {`)); // the generated conf already passes JWT_SECRET and NETGET_DATA_DIR through
fs.writeFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), highPorts(appConf));
fs.copyFileSync('/opt/homebrew/etc/openresty/mime.types', path.join(prefix, 'conf', 'mime.types'));
fs.cpSync(path.resolve(here, '../src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

// the config itself: no JWT machinery, no example routes behind it
assert.doesNotMatch(appConf, /jwt_cookie|jwt_cache|JWT_SECRET|resty\.jwt/, 'the generated app conf has no JWT machinery');
assert.doesNotMatch(fs.readFileSync(path.join(prefix, 'conf', 'nginx.conf'), 'utf8'), /JWT/, 'the generated main conf passes no JWT_SECRET through');
assert.doesNotMatch(appConf, /location \/(protected|test) /);
for (const gone of ['handlers/protected.lua', 'middleware/jwt_cookie.lua']) assert.equal(fs.existsSync(path.join(prefix, 'lua', gone)), false, `${gone} is gone`);
// the config itself: the internal credential is stripped wherever nginx proxies, and never set from anything
assert.match(appConf, /proxy_set_header X-Monad-Internal-Token "";/);
assert.doesNotMatch(appConf, /X-Monad-Internal-Token\s+(?!"")\S/i, 'nginx never sets the internal credential from anything');
for (const location of ['/openresty-restart', '/openresty-stop', '/dev-server-start', '/dev-server-stop', '/add-domain', '/update-domain', '/delete-domain', '/provision-cert', '/domains/metadata', '/networks']) {
  const at = appConf.search(new RegExp(`location (= )?${location.replace('/', '\\/')} \\{`));
  assert.ok(at >= 0, `${location} has a location`);
  assert.match(appConf.slice(at, at + 400), /limit_except GET HEAD OPTIONS \{\s*allow 127\.0\.0\.1;\s*allow ::1;\s*deny all;/, `${location} is for a process on this machine`);
}

let nginx: import('node:child_process').ChildProcess | null = null;
const stopNginx = () => { try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { /* not running */ } nginx?.kill(); nginx = null; };
const startNginx = async (env: Record<string, string>) => {
  stopNginx();
  await new Promise((r) => setTimeout(r, 300));
  const full = { ...process.env, ...env, NETGET_DATA_DIR: dataDir };
  const t = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full });
  let out = ''; t.stderr.on('data', (d) => { out += d; }); t.stdout.on('data', (d) => { out += d; });
  assert.equal(await new Promise((r) => t.on('close', r)), 0, `openresty -t failed:\n${out}`);
  nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full, stdio: 'ignore' });
  const listening = (port: number) => new Promise<boolean>((r) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  for (let i = 0; i < 50; i += 1) {
    if ((await listening(HTTP_PORT)) && (await listening(HTTPS_PORT))) { await new Promise((r) => setTimeout(r, 200)); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nginx did not start');
};

type Res = { status: number; text: string; json: any };
const call = (peer: string, scheme: 'http' | 'https', host: string, method: string, p: string, o: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const lib: any = scheme === 'https' ? https : http;
    const req = lib.request({ host: peer, port: scheme === 'https' ? HTTPS_PORT : HTTP_PORT, method, path: p, timeout: 8000, rejectUnauthorized: false, servername: host,
      headers: { host, accept: 'application/json', ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) } }, (res: any) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c: string) => { text += c; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, text, json }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${host}${p}`)));
    if (o.body !== undefined) req.write(JSON.stringify(o.body));
    req.end();
  });
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const forgeJwt = (secret: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
const cookie = (token: string) => ({ cookie: `token=${token}` });
const HOSTS = ['localhost', 'local.netget', '127.0.0.1'];

try {
  // ═══ 1. the gateway as it is ═════════════════════════════════════════════════════
  await startNginx({});

  // from this machine (also the logs, which the machine's own operator may read)
  const status = await call('127.0.0.1', 'http', 'localhost', 'GET', '/openresty-status');
  assert.equal(status.status, 200, `a process on this machine may ask: ${status.text.slice(0, 120)}`);
  assert.deepEqual(ran().slice(-1), ['status'], 'and it reached the handler');
  assert.notEqual((await call('127.0.0.1', 'http', 'localhost', 'GET', '/logs?type=access')).status, 401, 'and may read the server logs');
  // nginx lets the loopback client through; the monad still wants a credential
  assert.equal((await call('127.0.0.1', 'http', 'localhost', 'POST', '/add-domain', { body: { domain: 'evil.test', type: 'proxy' } })).status, 401);
  // the internal credential does not survive nginx: sent through it, it is as good as nothing...
  const viaEdge = { 'x-monad-internal-token': TOKEN };
  assert.equal((await call('127.0.0.1', 'http', 'localhost', 'POST', '/add-domain', { headers: viaEdge, body: { domain: 'via-edge.test', type: 'proxy', owner: 'netget' } })).status, 401, 'add-domain with the real token, through nginx');
  // (/__gateway/claim is not proxied at all -- only nginx's own internal location reaches it -- so from outside it is never a success)
  for (const p of ['/__gateway/claim', '/__netget/internal/gateway-claim']) {
    const r = await call('127.0.0.1', 'http', 'localhost', 'POST', p, { headers: viaEdge, body: { identityHash: 'a'.repeat(64), publicKey: 'A'.repeat(43) } });
    assert.ok(r.status >= 400, `${p} with the real token, through nginx, answered ${r.status}`);
  }
  // a routing record cannot be written through nginx with the real token either (nothing here proxies POST / to the monad)
  await call('127.0.0.1', 'http', 'edge-test.me', 'POST', '/', { headers: { ...viaEdge, 'x-forwarded-host': 'netget.edge-test.me' }, body: { operation: 'write', expression: 'domains.via__DOT__edge.target', value: 'http://10.0.0.1:80' } });
  const written: any = await (await fetch(`${monadOrigin}/domains.via__DOT__edge.target`, { headers: { 'x-forwarded-host': 'netget.edge-test.me', accept: 'application/json' } })).json();
  assert.ok(written?.target?.value === undefined || written?.target?.value === null, 'no routing record was written');
  // ...while the same request sent to the monad directly is accepted: the token still works where it belongs
  const direct = await fetch(`${monadOrigin}/add-domain`, { method: 'POST', headers: { 'content-type': 'application/json', ...viaEdge }, body: JSON.stringify({ domain: 'direct.test', type: 'proxy', owner: 'netget' }) });
  assert.equal(direct.status, 200);
  assert.deepEqual(((await (await fetch(`${monadOrigin}/domains`)).json()) as any).domains.map((d: any) => d.domain), ['direct.test']);

  if (lan) {
    // from another peer address, whatever Host it sends
    for (const host of [...HOSTS, lan]) {
      for (const [method, p] of [['POST', '/openresty-stop'], ['POST', '/openresty-restart'], ['POST', '/dev-server-start'], ['POST', '/dev-server-stop'],
        ['POST', '/add-domain'], ['POST', '/update-domain'], ['POST', '/delete-domain'], ['POST', '/provision-cert'], ['POST', '/domains/metadata'], ['POST', '/networks']] as const) {
        const r = await call(lan, 'http', host, method, p, { body: {} });
        assert.equal(r.status, 403, `${method} ${p} from ${lan} with Host ${host} answered ${r.status}`);
      }
      // reads that reach a Lua handler are refused there: plain HTTP is not a credential from another peer
      assert.equal((await call(lan, 'http', host, 'GET', '/openresty-status')).status, 401, `status from ${lan}, Host ${host}`);
      assert.equal((await call(lan, 'http', host, 'GET', '/dev-server-status')).status, 401);
    }
    // a cookie is not a credential, however it is made: a bare one, a forged JWT (signed with the old built-in
    // secret), over HTTP and over HTTPS, for the handlers that used to look at it
    for (const [scheme, cookieValue] of [['http', 'anything'], ['https', 'anything'], ['https', forgeJwt('dev_secret')], ['http', forgeJwt('dev_secret')]] as const) {
      for (const p of ['/openresty-status', '/dev-server-status', '/logs?type=access']) {
        const r = await call(lan, scheme, 'localhost', 'GET', p, { headers: cookie(cookieValue) });
        assert.equal(r.status, 401, `${scheme} ${p} with a cookie from ${lan} answered ${r.status}`);
      }
      assert.equal((await call(lan, scheme, 'localhost', 'POST', '/openresty-stop', { headers: cookie(cookieValue), body: {} })).status, 403);
    }
    // the gateway's own reads stay reachable
    assert.equal((await call(lan, 'http', 'localhost', 'GET', '/domains')).status, 200);
    assert.deepEqual(ran().filter((c) => c !== 'status'), [], 'nothing ran netget for the other peer');
  } else {
    console.log('gateway-edge-access.test.ts: no non-loopback address on this machine -- the other-peer half was skipped');
  }

  // ═══ 2. even if someone still sets JWT_SECRET, a token signed with it is not a credential ═══
  const secret = crypto.randomBytes(32).toString('hex');
  await startNginx({ JWT_SECRET: secret });
  if (lan) {
    const good = cookie(forgeJwt(secret));
    const before = ran().length;
    for (const scheme of ['http', 'https'] as const) {
      assert.equal((await call(lan, scheme, 'localhost', 'GET', '/openresty-status', { headers: good })).status, 401, `${scheme}: a token signed with a real secret is still nothing`);
      assert.equal((await call(lan, scheme, 'localhost', 'GET', '/logs?type=access', { headers: good })).status, 401);
      assert.equal((await call(lan, scheme, 'localhost', 'POST', '/openresty-stop', { headers: good, body: {} })).status, 403);
    }
    assert.equal(ran().length, before, 'nothing ran for the other peer');
  }
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  if (process.env.KEEP_EDGE_TEST_LOGS) console.log(`kept ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-edge-access.test.ts: all assertions passed');
process.exit(0);
