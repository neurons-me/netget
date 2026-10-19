// The pages nginx used to answer with its bare "openresty" error are entry points now: a browser NAVIGATION that hits
// a failure nginx itself produces (nothing behind a proxy) gets the front end, with the status it had; everything
// that is not a navigation keeps the plain error. Runs against a real disposable OpenResty built from the real
// generator; skipped when OpenResty is not installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('door-entry-point: skipped (no openresty on this machine)'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-door-entry-'));
const home = path.join(tmp, 'home');
const dataDir = path.join(tmp, 'data');
const dist = path.join(tmp, 'dist');
const prefix = path.join(tmp, 'or');
for (const d of [home, path.join(dataDir, 'runtime'), path.join(dataDir, 'html'), path.join(dist, 'assets')]) fs.mkdirSync(d, { recursive: true });
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });

const MARKER = 'ENTRY-POINT-MARKER-7f3a';
fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html><head><title>entry</title></head><body><div id="root"></div><!-- ${MARKER} --></body></html>`);
fs.writeFileSync(path.join(dataDir, 'xConfig.json'), JSON.stringify({ mainServerFrontendMode: 'package-dist', mainServerFrontendStaticRoot: dist }));

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});
const HTTP_PORT = await freePort();
const HTTPS_PORT = await freePort();
const DEAD_PORT = await freePort(); // nothing listens here: the gateway API and every monad are "off"

process.env.HOME = home;
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'localhost';
process.env.NETGET_GATEWAY_UPSTREAM = `http://127.0.0.1:${DEAD_PORT}`;
process.env.NETGET_MONAD_ORIGIN = `http://127.0.0.1:${DEAD_PORT}`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const certDir = path.join(tmp, 'cert'); fs.mkdirSync(certDir);
const keyFile = path.join(certDir, 'k.pem'); const crtFile = path.join(certDir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', '2', '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
fs.mkdirSync(path.join(home, '.netget', 'certs'), { recursive: true });
fs.copyFileSync(crtFile, path.join(home, '.netget', 'certs', 'local.netget.pem'));
fs.copyFileSync(keyFile, path.join(home, '.netget', 'certs', 'local.netget-key.pem'));

// One monad is registered but its process is dead (it heartbeated recently, then went away): the mesh path has its
// own error_page, and a location's error_page replaces the inherited one, so it must NOT turn into the entry point.
fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
  apps: {
    'monad:dead': {
      id: 'monad:dead', name: 'monad:dead', kind: 'monad', host: '127.0.0.1', port: DEAD_PORT, protocol: 'http',
      trust: 'owner', lastSeenMs: Date.now(), ttlMs: 600000,
      exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } },
      metadata: { monadName: 'dead', namespace: 'localhost' },
    },
  },
}));

const netgetTsRoot = path.resolve(import.meta.dirname, '..');
const { buildNginxConfigContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigFile.ts'));
const { getNetgetAppConfContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts'));
const layout = {
  layoutKey: 'linux-source', configDir: path.join(prefix, 'conf'), confDDir: path.join(prefix, 'conf.d'), logDir: path.join(prefix, 'logs'),
  configFilePath: path.join(prefix, 'conf', 'nginx.conf'), luaDir: path.join(prefix, 'lua'),
  luaPackagePath: `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;/opt/homebrew/opt/openresty/site/lualib/?.lua;/opt/homebrew/opt/openresty/lualib/?.lua`,
  userDirective: '', isSupported: true,
};
const highPorts = (conf: string) => conf
  .replace(/^\s*listen \[::\]:\d+.*;\n/gm, '')
  .replace(/listen 80( default_server)?;/g, `listen ${HTTP_PORT}$1;`)
  .replace(/listen 443 ssl( default_server)?;/g, `listen ${HTTPS_PORT} ssl$1;`);
const appConf = getNetgetAppConfContent(layout as any);
assert.match(appConf, /location @door_entry/, 'the generator emits the entry point');
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'),
  highPorts(buildNginxConfigContent(layout as any)).replace(/^events \{/m, `pid ${path.join(prefix, 'logs', 'nginx.pid')};\nevents {`));
fs.writeFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), highPorts(appConf));
fs.copyFileSync('/opt/homebrew/etc/openresty/mime.types', path.join(prefix, 'conf', 'mime.types'));
fs.cpSync(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

const env = { ...process.env, NETGET_DATA_DIR: dataDir };
const t = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env });
let testOut = ''; t.stderr.on('data', (d) => { testOut += d; }); t.stdout.on('data', (d) => { testOut += d; });
assert.equal(await new Promise((r) => t.on('close', r)), 0, `openresty -t failed:\n${testOut}`);
const nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env, stdio: 'ignore' });
const stop = () => { try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { /* best effort */ } nginx.kill(); };
process.on('exit', stop);
for (let i = 0; i < 60; i += 1) {
  const up = await new Promise<boolean>((r) => { const c = net.connect(HTTP_PORT, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  if (up) break;
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 300));

const NAVIGATION = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
function request(method: string, urlPath: string, accept: string, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, path: urlPath, method, headers: { host: 'localhost', accept, ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

try {
  // the static front end itself is untouched
  const root = await request('GET', '/', NAVIGATION);
  assert.equal(root.status, 200); assert.ok(root.body.includes(MARKER));

  // gateway API down + a browser navigation -> the entry point, still a 502
  for (const urlPath of ['/gateway-identity', '/setup/verify-code', '/admin-session/challenge', '/domains']) {
    const nav = await request('GET', urlPath, NAVIGATION);
    assert.equal(nav.status, 502, `${urlPath}: the status survives`);
    assert.ok(nav.body.includes(MARKER) && nav.body.includes('<div id="root">'), `${urlPath}: a navigation gets the front end`);
    assert.match(String(nav.headers['content-type']), /text\/html/);
    assert.equal(nav.headers['cache-control'], 'no-store', `${urlPath}: the entry point is never cached`);
  }

  // ...and anything that is not a navigation keeps the plain error it always had
  for (const accept of ['application/json', '*/*', 'text/plain', '']) {
    const plain = await request('GET', '/gateway-identity', accept);
    assert.equal(plain.status, 502, `accept "${accept}"`);
    assert.ok(plain.body.includes('502 Bad Gateway') && !plain.body.includes(MARKER), `accept "${accept}": the plain nginx page`);
  }
  const post = await request('POST', '/setup/verify-code', 'application/json', '{"code":"x"}');
  assert.equal(post.status, 502); assert.ok(!post.body.includes(MARKER), 'a POST is never a navigation');

  // no monad registered under that name: a navigation gets the entry point (404 kept), a fetch keeps its JSON
  const nav404 = await request('GET', '/apps/netget/__surface', NAVIGATION);
  assert.equal(nav404.status, 404); assert.ok(nav404.body.includes(MARKER));
  const json404 = await request('GET', '/apps/netget/__surface', 'application/json');
  assert.equal(json404.status, 404);
  assert.equal(JSON.parse(json404.body).error, 'monad_not_found');

  // a registered monad whose process is gone: the mesh path keeps ITS error page (a location's error_page replaces
  // the inherited one), it is not the entry point
  const dead = await request('GET', '/apps/dead/anything', NAVIGATION);
  assert.ok([502, 503, 504].includes(dead.status), `the mesh failure status survives (${dead.status})`);
  assert.ok(!dead.body.includes(MARKER), 'the mesh path keeps its own error page');

  console.log('✔ door-entry-point tests passed');
} finally {
  stop();
}
