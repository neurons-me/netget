// gateway-app-registration.test.ts
//
// The gate of /apps/report takes the registration netget() ALREADY sends (src/netget.ts), not a second protocol.
// `kind` is "app" | "service" | "system" (all listed as apps); the gate reduces whatever arrives to what an app may say.
//
// On disposable infra (an OpenResty on high ports with this repo's Lua, throwaway servers; nothing of the real machine):
//   [1] the REAL netget() library with `port: 'auto'` registers: it leases a port before anything listens (the gate says
//       422 until the app answers, the heartbeat then succeeds), the entry is kept under the lease id the library sent
//       and its name as sent, and stop() takes it out. This flow was refused outright before (it is not a monad);
//   [2] an app cannot take the place of a monad by choosing its id (409), and a monad entry is untouched by it;
//   [3] sanitising: category kept, unknown exposure/metadata keys dropped, a dist dir with `..` or odd characters
//       dropped, tags and strings capped, an unknown status dropped, the host/trust forced;
//   [4] doors: a connection of a door that points at `app:<name>` follows the policy the APP declared (no policy =
//       loopback-only; disabled = 404; allowLoopback=false = 403), never the policy of a monad of the same name, and a
//       guest MONAD still has no connections.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-app-registration-'));
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
  const mainServer = `http://localhost:${HTTP_PORT}`;
  const getApps = async () => ((await call('GET', '/apps')).json.apps || []) as any[];
  const listen = (port: number, label: string): Promise<http.Server> => new Promise((resolve) => {
    const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ who: label, url: req.url })); });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });

  console.log('\n[1] the real netget() registers an app that asked for an automatic port');
  const { netget } = await import(path.join(netgetTsRoot, 'src/netget.ts'));
  const lib = await netget({
    name: 'lib-auto', port: 'auto', kind: 'app', mainServer, heartbeatMs: 1000,
    tags: ['demo', 'vite'], status: 'running', health: { state: 'healthy', message: 'ok' },
    ui: { hasUserPanel: true, defaultPath: '/' }, lifecycle: { supportsStop: true },
    exposure: { visibility: 'lan', publishMode: 'domain', inbound: { paths: ['/etc'] }, network: { allowLan: true } },
    metadata: { title: 'Library app', entry: 'vite', directEndpoint: 'http://10.9.9.9:80', claimed_namespaces: ['victim.example'], identity_hash: 'f'.repeat(64), frontendDistDir: '/Users/x/app/dist' },
  });
  check('netget() leased a port (auto range) and reported without throwing though nothing listens yet', lib.port >= 42000 && lib.port <= 49999, String(lib.port));
  check('nothing listens: the entry is not in the registry (the gate refused with 422, the library did not fail)', !(await getApps()).some((a: any) => a.id === lib.id));
  const libServer = await listen(lib.port, 'LIB-AUTO');
  await lib.report();
  {
    const found = (await getApps()).find((a: any) => a.id === lib.id);
    check('once the app answers, the next beat is accepted and the entry has the id the library sent (its lease id)', !!found, lib.id);
    check('kind "app", category "app", name as sent', !!found && found.kind === 'app' && found.category === 'app' && found.name === 'lib-auto', JSON.stringify(found));
    check('host is the loopback, trust is guest, no verifiedMonadId', !!found && found.host === '127.0.0.1' && found.trust === 'guest' && found.verifiedMonadId === undefined, JSON.stringify(found));
    check('title and entry are kept; directEndpoint, claimed_namespaces and identity_hash are dropped', !!found && found.metadata?.title === 'Library app' && found.metadata?.entry === 'vite'
      && !found.metadata?.directEndpoint && !found.metadata?.claimed_namespaces && !found.metadata?.identity_hash, JSON.stringify(found?.metadata));
    check('frontendDistDir (absolute, plain) is kept as a claim', !!found && found.metadata?.frontendDistDir === '/Users/x/app/dist', JSON.stringify(found?.metadata));
    check('status, health, ui and tags are kept', !!found && found.status === 'running' && found.health?.state === 'healthy' && found.ui?.defaultPath === '/' && found.tags?.[0] === 'demo', JSON.stringify(found));
    check('exposure keeps what the gateway reads (visibility, network) and drops the rest (publishMode, inbound)',
      !!found && found.exposure?.visibility === 'lan' && found.exposure?.network?.allowLan === true && found.exposure?.publishMode === undefined && found.exposure?.inbound === undefined, JSON.stringify(found?.exposure));
    check('pid is the library\'s process', !!found && found.pid === process.pid, String(found?.pid));
  }
  await lib.stop();
  check('stop() releases the entry', !(await getApps()).some((a: any) => a.id === lib.id));
  libServer.close();

  console.log('\n[2] an app cannot take a monad\'s id');
  const plain = await listen(await freePort(), 'plain');
  const plainPort = (plain.address() as any).port;
  {
    const nowMs = Date.now();
    const monadEntry = { id: 'monad:held', name: 'monad:held', kind: 'monad', host: '127.0.0.1', port: monadPort, protocol: 'http', ttlMs: 600000, lastSeenMs: nowMs, trust: 'peer', metadata: { monadName: 'held', identity_hash: 'a'.repeat(64) } };
    writeRegistry({ apps: { 'monad:held': monadEntry } });
    const r = await call('POST', '/apps/report', { id: 'monad:held', name: 'held', kind: 'app', port: plainPort });
    check('an app reporting with the id of a monad entry -> 409 ID_TAKEN', r.status === 409 && r.json.error === 'ID_TAKEN', JSON.stringify(r.json));
    const after = readRegistry().apps['monad:held'];
    check('the monad entry is exactly as it was', JSON.stringify(after) === JSON.stringify(monadEntry), JSON.stringify(after));
    const bad = await call('POST', '/apps/report', { id: '../x', name: 'held', kind: 'app', port: plainPort });
    check('an id with odd characters -> 400', bad.status === 400, JSON.stringify(bad.json));
  }

  console.log('\n[3] sanitising');
  writeRegistry({ apps: {} });
  {
    const r = await call('POST', '/apps/report', {
      id: 'sys-1', name: 'Sys.Thing', kind: 'system', port: plainPort, host: '10.0.0.5', trust: 'owner', status: 'bogus',
      tags: Array.from({ length: 40 }, (_, i) => `tag-${i}-${'x'.repeat(100)}`), pid: -5, cwd: 'c'.repeat(900),
      health: { state: 'on-fire' }, exposure: { visibility: 'everywhere', auth: { mode: 'magic', requiredForRead: true } },
      metadata: { title: 't'.repeat(500), frontendDistDir: '/a/../../etc', monad: 'm', entry: 'weird' },
    });
    check('a system service reports -> 200 with its category', r.status === 200 && r.json.category === 'system', JSON.stringify(r.json));
    const found = (await getApps()).find((a: any) => a.id === 'sys-1');
    check('the name is lowercased as the gate always did', !!found && found.name === 'sys.thing', JSON.stringify(found?.name));
    check('host forced to the loopback and trust to guest, whatever it sent', !!found && found.host === '127.0.0.1' && found.trust === 'guest', JSON.stringify(found));
    check('an unknown status, health state, visibility and auth mode are dropped', !!found && found.status === undefined && found.health === undefined && found.exposure?.visibility === undefined && found.exposure?.auth?.mode === undefined, JSON.stringify(found));
    check('a boolean it declared is kept (requiredForRead)', !!found && found.exposure?.auth?.requiredForRead === true, JSON.stringify(found?.exposure));
    check('tags capped at 16, each at 40 characters', !!found && found.tags.length === 16 && found.tags.every((t: string) => t.length <= 40), String(found?.tags?.length));
    check('title capped, dist dir with ".." dropped, entry that is not a known kind dropped', !!found && found.metadata?.title.length <= 80 && found.metadata?.frontendDistDir === undefined && found.metadata?.entry === undefined, JSON.stringify(found?.metadata));
    check('cwd capped, a negative pid dropped', !!found && found.cwd.length <= 200 && found.pid === undefined, JSON.stringify([found?.cwd?.length, found?.pid]));
    const odd = await call('POST', '/apps/report', { id: 'sys-2', name: 'sys2', kind: 'service', port: plainPort, metadata: { frontendDistDir: '/a/b c/$(rm -rf)' } });
    const foundOdd = (await getApps()).find((a: any) => a.id === 'sys-2');
    check('a dist dir with spaces or shell characters is dropped; category "service" is kept', odd.status === 200 && foundOdd?.category === 'service' && foundOdd?.metadata?.frontendDistDir === undefined, JSON.stringify(foundOdd));
    const unknownKind = await call('POST', '/apps/report', { id: 'z', name: 'zed', kind: 'daemon', port: plainPort });
    check('an unknown kind -> 400', unknownKind.status === 400, JSON.stringify(unknownKind.json));
  }
  {
    // frontendMode is the operator's: a beat of the app does not erase it
    const reg = readRegistry(); reg.apps['sys-1'].frontendMode = 'dist'; writeRegistry(reg);
    await call('POST', '/apps/report', { id: 'sys-1', name: 'sys.thing', kind: 'system', port: plainPort });
    check('the operator\'s frontendMode survives the app\'s next beat', readRegistry().apps['sys-1'].frontendMode === 'dist');
  }

  console.log('\n[4] doors: connections follow the policy the APP declared');
  const service = await listen(await freePort(), 'SERVICE');
  const servicePort = (service.address() as any).port;
  const MACHINE = (() => { const h = os.hostname().toLowerCase(); return h.endsWith('.local') ? h : `${h}.local`; })();
  const DOOR = `door.${MACHINE}`;
  fs.writeFileSync(domainMapPath, JSON.stringify({ version: 1, domains: { [DOOR]: { type: 'server', target: 'app:conn', ssl: { enabled: false }, connections: [{ prefix: '/api/fuel', target: `127.0.0.1:${servicePort}` }] } } }));
  const reportConn = (exposure?: Record<string, unknown>) => call('POST', '/apps/report', { id: 'app:conn', name: 'conn', kind: 'app', port: plainPort, ttlMs: 60000, ...(exposure ? { exposure } : {}) });
  {
    await reportConn();
    const r = await viaHost(DOOR, '/api/fuel/1');
    check('an app that declared nothing: a loopback peer reaches the connection (before, a guest app entry was refused outright)', r.status === 200 && r.text.includes('SERVICE'), `${r.status} ${r.text.slice(0, 120)}`);
    await reportConn({ enabled: false });
    const off = await viaHost(DOOR, '/api/fuel/1');
    check('an app that declared itself disabled: 404', off.status === 404, `${off.status} ${off.text.slice(0, 120)}`);
    await reportConn({ network: { allowLoopback: false } });
    const noLoop = await viaHost(DOOR, '/api/fuel/1');
    check('an app that refuses loopback: 403', noLoop.status === 403, `${noLoop.status} ${noLoop.text.slice(0, 120)}`);
  }
  {
    // a monad of the same name does NOT lend its policy to the app, nor does the app lend its own to the monad
    const nowMs = Date.now();
    const monad = { id: 'monad:conn', name: 'monad:conn', kind: 'monad', host: '127.0.0.1', port: monadPort, protocol: 'http', ttlMs: 600000, lastSeenMs: nowMs, trust: 'peer',
      exposure: { enabled: true, visibility: 'wan', network: { allowWan: true, allowLoopback: true } }, metadata: { monadName: 'conn', identity_hash: 'a'.repeat(64) } };
    writeRegistry({ apps: { 'monad:conn': monad } });
    await reportConn({ enabled: false });
    const reg = readRegistry(); reg.apps['monad:conn'] = monad; writeRegistry(reg);
    const both = await viaHost(DOOR, '/api/fuel/1');
    check('app (disabled) and monad (open) under one name: the door follows the APP -> 404, no inheritance', both.status === 404, `${both.status} ${both.text.slice(0, 120)}`);
    const guestMonad = { ...monad, trust: 'guest' };
    writeRegistry({ apps: { 'monad:conn': guestMonad } });
    const g = await viaHost(DOOR, '/api/fuel/1');
    check('only a GUEST monad is live under the name: still no connections (403)', g.status === 403, `${g.status} ${g.text.slice(0, 120)}`);
    writeRegistry({ apps: { 'monad:conn': monad } });
    const p = await viaHost(DOOR, '/api/fuel/1');
    check('only a PEER monad is live under the name: its own policy still applies (connection answered)', p.status === 200 && p.text.includes('SERVICE'), `${p.status} ${p.text.slice(0, 120)}`);
  }

  for (const s of [plain, service]) s.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  for (const pid of monadsPidsToClean) { if (isPidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } }
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('app registration complete');
