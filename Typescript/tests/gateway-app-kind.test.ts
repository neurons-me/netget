// gateway-app-kind.test.ts
//
// An APP is not a monad. The registry used to take only monads (/apps/report probes /__surface for a monadId), so a Vite
// dev server, a built dist behind a static server, or any plain server could not be listed; and what the monad served
// (its own dist) was listed as the monad. `kind: "app"` is what lets the thing people open be reported as itself.
//
// What this file proves, on disposable infra (an OpenResty on high ports with this repo's Lua, a throwaway monad, throwaway
// servers and child processes; nothing of the real machine is touched):
//   [1] an app on a plain server (answers HTTP, is not a monad) is accepted with kind "app", and is listed as one:
//       no verifiedMonadId, trust "guest", whatever identity it claims;
//   [2] the monad gate is intact: with no kind (or kind "monad") a port that is not a monad is still PORT_NOT_VERIFIED;
//       an app on a port where nothing answers is PORT_NOT_ANSWERING and never reaches the registry;
//   [3] an app entry carries only what an app may say: a metadata directEndpoint / claimed_namespaces it sends is dropped,
//       and its host is the loopback, whatever it sends;
//   [4] a fully authorized restart-all never touches an app's process (a real child process, a real pid), even when the
//       app's port is also where a monad answers;
//   [5] routing: a declared `app:<name>` route goes to the APP when the name has both an app and a monad entry, and to the
//       monad when only the monad exists (nothing that worked stops working); and an app entry, even a hand-written one
//       that declares a host, is never chosen as the monad of a host (the selection by declaration ignores apps);
//   [6] /apps/release takes an app out by id.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import ME from 'this.me';
import cleaker from 'cleaker';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-app-kind-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'registry-verify.me';
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

const netgetTsRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const modulePath = path.resolve(netgetTsRoot, 'src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad'); fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'registry-verify-seed', namespace: 'registry-verify.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'registry-verify.me', selfHostname: 'registry-verify.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const monadOrigin = `http://127.0.0.1:${(monad.address() as any).port}`;
const monadPort = (monad.address() as any).port;
process.env.NETGET_MONAD_ORIGIN = monadOrigin;
process.env.NETGET_GATEWAY_UPSTREAM = monadOrigin;

const { buildNginxConfigContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigFile.ts'));
const { getNetgetAppConfContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts'));
const layout: any = {
  layoutKey: 'linux-source', configDir: path.join(prefix, 'conf'), confDDir: path.join(prefix, 'conf.d'), logDir: path.join(prefix, 'logs'),
  configFilePath: path.join(prefix, 'conf', 'nginx.conf'), luaDir: path.join(prefix, 'lua'),
  luaPackagePath: `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;/opt/homebrew/opt/openresty/site/lualib/?.lua;/opt/homebrew/opt/openresty/site/lualib/?/init.lua;;`, userDirective: '', isSupported: true,
};
const highPorts = (conf: string) => conf
  .replace(/^\s*listen \[::\]:\d+.*;\n/gm, '')
  .replace(/listen 80( default_server)?;/g, `listen ${HTTP_PORT}$1;`)
  .replace(/listen 443 ssl( default_server)?;/g, `listen ${HTTPS_PORT} ssl$1;`);
const appConf = getNetgetAppConfContent(layout);
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), highPorts(buildNginxConfigContent(layout)).replace(/^events \{/m, `pid ${path.join(prefix, 'logs', 'nginx.pid')};\nevents {`));
fs.writeFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), highPorts(appConf));
fs.copyFileSync('/opt/homebrew/etc/openresty/mime.types', path.join(prefix, 'conf', 'mime.types'));
fs.cpSync(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

let nginx: import('node:child_process').ChildProcess | null = null;
const stopNginx = () => { try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { } nginx?.kill(); nginx = null; };
const startNginx = async () => {
  const full = { ...process.env, NETGET_DATA_DIR: dataDir };
  const t = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full });
  let out = ''; t.stderr.on('data', (d) => { out += d; }); t.stdout.on('data', (d) => { out += d; });
  assert.equal(await new Promise((r) => t.on('close', r)), 0, `openresty -t failed:\n${out}`);
  nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full, stdio: 'ignore' });
  const listening = (port: number) => new Promise<boolean>((r) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  for (let i = 0; i < 50; i += 1) {
    if (await listening(HTTP_PORT)) { await new Promise((r) => setTimeout(r, 200)); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nginx did not start');
};

const call = (method: string, p: string, bodyObj?: Record<string, unknown>): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const headers: Record<string, string> = { host: 'localhost', connection: 'close' };
  if (bodyStr) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(bodyStr)); }
  const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers }, (res) => {
    let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
    res.on('end', () => { let json: any = {}; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode || 0, json }); });
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
  if (bodyStr) req.write(bodyStr);
  req.end();
});

// ── signing helpers for the restart-all authorization layer ────────────────
function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
}
function genNonce(): string { return crypto.randomBytes(16).toString('hex'); }
function sha256Hex(data: string): string { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

async function signedCall(node: any, method: string, p: string, bodyObj?: Record<string, unknown>, opts: { noProof?: boolean } = {}): Promise<{ status: number; json: any }> {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers: Record<string, string> = { host: 'localhost', connection: 'close' };
  if (bodyStr) headers['content-type'] = 'application/json';
  if (!opts.noProof) {
    const signed = { method, path: p, bodyHash: sha256Hex(bodyStr), nonce: genNonce(), timestamp: Date.now() };
    const challenge = canonicalJson(signed);
    const proof = await node.prove({ rootNamespace: 'localhost', challenge });
    headers['x-me-proof'] = Buffer.from(JSON.stringify(proof)).toString('base64url');
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
      res.on('end', () => { let json: any = {}; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode || 0, json }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Polls a port until something answers an HTTP GET there, or times out --
// used for the catalog-spawned process below, which is launched via
// netget's own io.popen() (output redirected to a log file this test
// doesn't have a pipe to), not via this test's own child_process.spawn()
// with a readable stdout.
async function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', timeout: 300 }, () => resolve(true));
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`port ${port} did not come up within ${timeoutMs}ms`);
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const claimsPath = path.join(dataDir, 'runtime', 'gateway-claims.json');
function readClaims(): any {
  if (!fs.existsSync(claimsPath)) return { pubkeys: {}, grants: {}, admins: {}, usernames: {}, owner: null };
  return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
}
function writeClaims(claims: any) { fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf8'); }

const ME_RESEED = Symbol.for('me.internal.reseed');
const me = new (ME as any)();
(me as any)[ME_RESEED]('registry-verify-identity', 'registry-verify-secret-do-not-reuse');
const node = cleaker(me as any, 'localhost');
const idProof = await node.prove({ rootNamespace: 'localhost', challenge: null });
const identityHash = idProof.identityHash;
const publicKey = idProof.publicKey;

function anchor(opts: { admin?: boolean; scopes?: string[] } = {}) {
  const claims = readClaims();
  claims.pubkeys = claims.pubkeys || {};
  claims.grants = claims.grants || {};
  claims.admins = claims.admins || {};
  claims.usernames = claims.usernames || {};
  claims.pubkeys[identityHash] = publicKey;
  claims.usernames[identityHash] = 'registry-verify-identity';
  if (opts.admin) claims.admins[identityHash] = true; else delete claims.admins[identityHash];
  if (opts.scopes) claims.grants[identityHash] = opts.scopes; else delete claims.grants[identityHash];
  writeClaims(claims);
}

let pass = 0; let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
};

// Safety net for the catalog-spawned process below -- a REAL, backgrounded
// OS process that survives this test script's own exit (that's the whole
// point of a daemon-style spawn). A successful restart-all already kills
// it; this is only for a thrown assertion or an unexpected early exit
// between spawning it and that point, so a failed run doesn't leave an
// orphaned node process running forever (found exactly that happening
// while debugging this file -- several from earlier failed attempts were
// still alive and had to be killed by hand).
let catalogSpawnedPidForCleanup: number | null = null;

const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []); // an empty Lua table is encoded as {}
const monadsPidsToClean: number[] = [];
const startHttp = (label: string): Promise<{ port: number; server: http.Server }> => new Promise((resolve) => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ who: label, url: req.url })); });
  server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as any).port, server }));
});
const spawnHttpChild = async (label: string, withSurface = false): Promise<{ port: number; proc: import('node:child_process').ChildProcess; pid: number }> => {
  const port = await freePort();
  const script = `require('http').createServer((q,r)=>{ if(${withSurface} && q.url==='/__surface'){r.setHeader('content-type','application/json');return r.end(JSON.stringify({monadId:'monad:${label}'}));} r.end('${label}'); }).listen(${port},'127.0.0.1',()=>console.log('UP'))`;
  const proc = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise<void>((resolve, reject) => { let out = ''; proc.stdout!.on('data', (d) => { out += d; if (out.includes('UP')) resolve(); }); proc.on('error', reject); setTimeout(() => reject(new Error('timeout')), 5000); });
  monadsPidsToClean.push(proc.pid!);
  return { port, proc, pid: proc.pid! };
};
const appsPath = path.join(dataDir, 'runtime', 'apps.json');
const readRegistry = () => JSON.parse(fs.readFileSync(appsPath, 'utf8'));
const writeRegistry = (r: unknown) => fs.writeFileSync(appsPath, JSON.stringify(r), 'utf8');
const domainMapPath = path.join(dataDir, 'runtime', 'domain-map.json');
// the machine-host blocks redirect http -> https, so a routed host is asked over the harness's own https listener
const viaHost = (host: string, p = '/'): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
  const req = https.request({ host: '127.0.0.1', port: HTTPS_PORT, path: p, method: 'GET', timeout: 8000, rejectUnauthorized: false, servername: 'localhost', headers: { host, connection: 'close' } }, (res) => {
    let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode || 0, text }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
});

try {
  await startNginx();

  console.log('\n[1] an app on a plain server (not a monad) can report, and is listed as an app');
  const plain = await startHttp('plain-app');
  {
    const r = await call('POST', '/apps/report', { id: 'app:plain', name: 'plain', kind: 'app', port: plain.port, metadata: { title: 'Plain', monad: 'some-monad', entry: 'vite', identity_hash: identityHash } });
    check('POST /apps/report {kind:"app"} on a plain HTTP server -> 200', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
  }
  {
    const r = await call('GET', '/apps');
    const found = (r.json.apps || []).find((a: any) => a.id === 'app:plain');
    check('it is listed, with kind "app"', !!found && found.kind === 'app', JSON.stringify(found));
    check('it has no verifiedMonadId (nothing verified it as a monad)', !!found && found.verifiedMonadId === undefined, JSON.stringify(found));
    check('its trust is "guest" even though it sent a real identity hash (an app\'s own word proves nothing)', !!found && found.trust === 'guest', JSON.stringify(found));
    check('the title and the monad it names are kept', !!found && found.metadata?.title === 'Plain' && found.metadata?.monad === 'some-monad' && found.metadata?.entry === 'vite', JSON.stringify(found?.metadata));
  }

  console.log('\n[2] the monad gate is intact; an app on a dead port is rejected');
  {
    const r = await call('POST', '/apps/report', { id: 'x-1', name: 'no-kind-plain', port: plain.port });
    check('no kind + a port that is not a monad -> still 422 PORT_NOT_VERIFIED', r.status === 422 && r.json.error === 'PORT_NOT_VERIFIED', JSON.stringify(r.json));
  }
  {
    const r = await call('POST', '/apps/report', { id: 'x-2', name: 'monad-kind-plain', kind: 'monad', port: plain.port });
    check('kind "monad" + a port that is not a monad -> 422 PORT_NOT_VERIFIED', r.status === 422 && r.json.error === 'PORT_NOT_VERIFIED', JSON.stringify(r.json));
  }
  {
    const deadPort = await freePort();
    const r = await call('POST', '/apps/report', { id: 'app:dead', name: 'dead', kind: 'app', port: deadPort });
    check('kind "app" + nothing listening -> 422 PORT_NOT_ANSWERING', r.status === 422 && r.json.error === 'PORT_NOT_ANSWERING', JSON.stringify(r.json));
    const listed = (await call('GET', '/apps')).json.apps || [];
    check('and it never reached the registry', !listed.some((a: any) => a.id === 'app:dead'));
  }
  {
    const r = await call('POST', '/apps/report', { id: 'app:badname', name: '../../etc', kind: 'app', port: plain.port });
    check('an app name that is not a plain name -> 400', r.status === 400, JSON.stringify(r.json));
    const r2 = await call('POST', '/apps/report', { id: 'app:weird', name: 'weird', kind: 'something-else', port: plain.port });
    check('an unknown kind -> 400', r2.status === 400, JSON.stringify(r2.json));
  }

  console.log('\n[3] an app entry carries only what an app may say');
  {
    const r = await call('POST', '/apps/report', {
      id: 'app:greedy', name: 'greedy', kind: 'app', port: plain.port, host: '10.9.9.9',
      metadata: { directEndpoint: 'http://10.9.9.9:80', claimed_namespaces: ['victim.example'], identity_hash: 'f'.repeat(64), title: 'Greedy' },
    });
    check('reporting with extra fields -> 200', r.status === 200, JSON.stringify(r.json));
    const found = ((await call('GET', '/apps')).json.apps || []).find((a: any) => a.id === 'app:greedy');
    check('its host is the loopback, not what it sent', !!found && found.host === '127.0.0.1', JSON.stringify(found));
    check('directEndpoint and claimed_namespaces are not kept', !!found && !found.metadata?.directEndpoint && !found.metadata?.claimed_namespaces, JSON.stringify(found?.metadata));
    check('an identity hash it sent is not kept as the app\'s identity', !!found && !found.metadata?.identity_hash && !found.metadata?.identityHash, JSON.stringify(found?.metadata));
  }

  console.log('\n[4] a fully authorized restart-all never touches an app\'s process');
  const appChild = await spawnHttpChild('app-child');
  const monadChild = await spawnHttpChild('monad-child', true);
  let appChildExited = false; appChild.proc.on('exit', () => { appChildExited = true; });
  let monadChildExited = false; monadChild.proc.on('exit', () => { monadChildExited = true; });
  {
    const a = await call('POST', '/apps/report', { id: 'app:child', name: 'child-app', kind: 'app', port: appChild.port });
    check('the child app reports -> 200', a.status === 200, JSON.stringify(a.json));
    // the app sits on the very port where a monad answers: the monad's own entry and the app's entry are two entries
    const b = await call('POST', '/apps/report', { id: 'monad:child', name: 'monad:child-monad', kind: 'monad', port: monadChild.port });
    check('a monad reports on its own port -> 200', b.status === 200, JSON.stringify(b.json));
    const c = await call('POST', '/apps/report', { id: 'app:on-monad-port', name: 'on-monad-port', kind: 'app', port: monadChild.port });
    check('an app can be reported on the port where a monad answers -> 200', c.status === 200, JSON.stringify(c.json));
  }
  anchor({ admin: true, scopes: ['gateway:control:apps-restart-all'] });
  {
    const r = await signedCall(node, 'POST', '/apps/restart-all', {});
    console.log(`  /apps/restart-all (authorized) -> ${r.status} ${JSON.stringify(r.json).slice(0, 260)}`);
    await new Promise((x) => setTimeout(x, 500));
    check('restart-all answers 200', r.status === 200, JSON.stringify(r.json));
    check('the app\'s process (a real pid) is alive', !appChildExited && isPidAlive(appChild.pid));
    check('the monad process, which netget did not spawn, is alive as well (the existing rule is unchanged)', !monadChildExited && isPidAlive(monadChild.pid));
    const touched = [...arr(r.json.restarted), ...arr(r.json.skipped)];
    check('no app entry is among what restart-all restarted', !arr(r.json.restarted).some((x: any) => String(x.name || x.id || '').includes('app')), JSON.stringify(r.json.restarted));
    check('an app entry is not even evaluated (no entry of kind app among restarted or skipped)', !touched.some((x: any) => x.kind === 'app' || String(x.id || '').startsWith('app:')), JSON.stringify(touched));
  }

  console.log('\n[5] routing: apps are found by name; an app is never chosen as a host\'s monad');
  const routeApp = await startHttp('ROUTE-APP');
  const routeMonad = await startHttp('ROUTE-MONAD');
  const nowMs = Date.now();
  const monadEntry = (name: string, port: number) => ({ id: `monad:${name}`, name: `monad:${name}`, kind: 'monad', host: '127.0.0.1', port, protocol: 'http', ttlMs: 600000, lastSeenMs: nowMs, trust: 'peer',
    metadata: { directEndpoint: `http://127.0.0.1:${port}`, monadName: name, identity_hash: 'a'.repeat(64) } });
  const appEntry = (name: string, port: number) => ({ id: `app:${name}`, name, kind: 'app', host: '127.0.0.1', port, protocol: 'http', ttlMs: 600000, lastSeenMs: nowMs, trust: 'guest', metadata: { title: name } });
  // the hosts the generated config sends through surface_proxy.lua: <machine>.local and <label>.<machine>.local
const MACHINE = (() => { const h = os.hostname().toLowerCase(); return h.endsWith('.local') ? h : `${h}.local`; })();
  const DOOR = `door.${MACHINE}`;
  fs.writeFileSync(domainMapPath, JSON.stringify({ version: 1, domains: { [DOOR]: { type: 'server', target: 'app:pair', ssl: { enabled: false } } } }));
  writeRegistry({ apps: { 'monad:pair': monadEntry('pair', routeMonad.port) } });
  {
    const r = await viaHost(DOOR);
    check('only the monad is registered under the name: the route goes to the monad (what worked keeps working)', r.status === 200 && r.text.includes('ROUTE-MONAD'), `${r.status} ${r.text.replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0, 260)}`);
  }
  writeRegistry({ apps: { 'monad:pair': monadEntry('pair', routeMonad.port), 'app:pair': appEntry('pair', routeApp.port) } });
  {
    let allApp = true; const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) { const r = await viaHost(DOOR); seen.push(r.text.includes('ROUTE-APP') ? 'app' : r.text.includes('ROUTE-MONAD') ? 'monad' : `?${r.status}`); if (!seen[i].startsWith('app')) allApp = false; }
    check('the name has an app and a monad: the declared app:<name> route goes to the APP, every time', allApp, seen.join(','));
  }
  {
    // an app entry that DECLARES a host (a hand-written registry entry: report_app would not keep this) is not a host's monad
    const HOSTILE = `declared.${MACHINE}`;
    const hostile = { ...appEntry('hostile', routeApp.port), metadata: { directEndpoint: `http://127.0.0.1:${routeApp.port}`, claimed_namespaces: [HOSTILE], identity_hash: 'b'.repeat(64) } };
    writeRegistry({ apps: { 'app:hostile': hostile } });
    fs.writeFileSync(domainMapPath, JSON.stringify({ version: 1, domains: {} }));
    const r = await viaHost(HOSTILE);
    check('selection by declaration: an app entry that declares a host does not become that host\'s monad', !r.text.includes('ROUTE-APP'), `${r.status} ${r.text.slice(0, 160)}`);
    const withMonad = { apps: { 'app:hostile': hostile, 'monad:real': { ...monadEntry('real', routeMonad.port), metadata: { directEndpoint: `http://127.0.0.1:${routeMonad.port}`, monadName: 'real', claimed_namespaces: [HOSTILE], identity_hash: 'c'.repeat(64) } } } };
    writeRegistry(withMonad);
    const r2 = await viaHost(HOSTILE);
    check('and with a real monad declaring the same host, the monad serves (no conflict raised by the app)', r2.status === 200 && r2.text.includes('ROUTE-MONAD'), `${r2.status} ${r2.text.slice(0, 160)}`);
  }

  console.log('\n[6] /apps/release takes an app out by id');
  writeRegistry({ apps: {} });
  {
    await call('POST', '/apps/report', { id: 'app:gone', name: 'gone', kind: 'app', port: plain.port });
    const rel = await call('POST', '/apps/release', { id: 'app:gone' });
    check('release -> 200', rel.status === 200, JSON.stringify(rel.json));
    check('and it is no longer listed', !((await call('GET', '/apps')).json.apps || []).some((a: any) => a.id === 'app:gone'));
  }

  for (const s of [plain.server, routeApp.server, routeMonad.server]) s.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  for (const pid of monadsPidsToClean) { if (isPidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } }
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('app kind probe complete');
