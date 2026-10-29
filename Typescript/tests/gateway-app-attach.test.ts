// gateway-app-attach.test.ts
//
// `netget attach`: the reporting side of an APP (src/gateway/attach.ts and the CLI commands on top of it), against a
// disposable gateway (an OpenResty on high ports with this repo's Lua). gateway-app-kind.test.ts proves what the gateway
// accepts and refuses; this proves what an app (or the CLI) sends, and that the entry lives and dies as it should:
//   [1] the report body: name, port and entry are validated before anything is sent; the body is exactly what the gateway reads;
//   [2] reportApp lists the app; a dead port is a refusal (not an exception) and lists nothing;
//   [3] attachLoop keeps the entry alive (it is still there after more than one beat) and takes it out when stopped;
//   [4] the CLI: `attach --once --json` lists, `detach --json` releases, `attach` on a dead port exits non-zero.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import ME from 'this.me';
import cleaker from 'cleaker';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-app-attach-'));
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

const { appReportBody, reportApp, releaseApp, attachLoop, validateAppName } = await import(path.join(netgetTsRoot, 'src/gateway/attach.ts'));
const target = { base: `http://127.0.0.1:${HTTP_PORT}`, hostHeader: 'localhost' };
const listApps = async () => (await call('GET', '/apps')).json.apps || [];
const server = await new Promise<http.Server>((resolve) => { const s = http.createServer((q, r) => r.end('app')); s.listen(0, '127.0.0.1', () => resolve(s)); });
const appPort = (server.address() as any).port;
const deadPort = await freePort();
const cli = (args: string[]): Promise<{ code: number | null; out: string }> => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--import', 'tsx', path.join(netgetTsRoot, 'src/netget.cli.ts'), ...args], {
    env: { ...process.env, NETGET_LOCAL: target.base, NETGET_LOCAL_HOST: 'localhost', NETGET_DATA_DIR: dataDir, HOME: home }, cwd: netgetTsRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

try {
  await startNginx();

  console.log('\n[1] the report body is validated before anything is sent');
  {
    const body: any = appReportBody({ name: 'FullTrailer', port: 4100, title: 'FullTrailer', monad: 'fulltrailer', entry: 'dist' });
    check('the id is app:<lowercased name>, the kind is app', body.id === 'app:fulltrailer' && body.name === 'fulltrailer' && body.kind === 'app', JSON.stringify(body));
    check('title, monad and entry go in metadata, and nothing else does', JSON.stringify(Object.keys(body.metadata).sort()) === JSON.stringify(['entry', 'monad', 'title']), JSON.stringify(body.metadata));
    for (const [label, fn] of [
      ['an empty name', () => appReportBody({ name: '', port: 4100 })],
      ['a path as a name', () => appReportBody({ name: '../etc', port: 4100 })],
      ['a name with a space', () => appReportBody({ name: 'my app', port: 4100 })],
      ['port 0', () => appReportBody({ name: 'a', port: 0 })],
      ['a port past 65535', () => appReportBody({ name: 'a', port: 70000 })],
      ['a fractional port', () => appReportBody({ name: 'a', port: 80.5 })],
      ['an unknown entry', () => appReportBody({ name: 'a', port: 80, entry: 'docker' as any })],
    ] as const) {
      let threw = false; try { fn(); } catch { threw = true; }
      check(`${label} throws, nothing is sent`, threw);
    }
    check('validateAppName agrees with the gateway on a good name', validateAppName('polls.studio') === null);
  }

  console.log('\n[2] reportApp lists the app; a dead port is a refusal, not an exception');
  {
    const r = await reportApp({ name: 'attach-demo', port: appPort, title: 'Demo', entry: 'static' }, target);
    check('reportApp -> ok, id app:attach-demo', r.ok && r.id === 'app:attach-demo', JSON.stringify(r));
    const found = (await listApps()).find((a: any) => a.id === 'app:attach-demo');
    check('it is in the registry as an app', !!found && found.kind === 'app' && found.port === appPort, JSON.stringify(found));
    const bad = await reportApp({ name: 'attach-dead', port: deadPort }, target);
    check('a dead port -> ok false, PORT_NOT_ANSWERING (no throw)', !bad.ok && bad.status === 422 && bad.error === 'PORT_NOT_ANSWERING', JSON.stringify(bad));
    check('and it lists nothing', !(await listApps()).some((a: any) => a.id === 'app:attach-dead'));
    const rel = await releaseApp('attach-demo', target);
    check('releaseApp -> ok', rel.ok, JSON.stringify(rel));
    check('and the entry is gone', !(await listApps()).some((a: any) => a.id === 'app:attach-demo'));
  }

  console.log('\n[3] attachLoop keeps the entry alive and takes it out when stopped');
  {
    const stop = new AbortController(); const beats: any[] = [];
    const done = attachLoop({ name: 'loop-demo', port: appPort }, { target, intervalMs: 250, signal: stop.signal, onBeat: (b: any) => beats.push(b) });
    await new Promise((r) => setTimeout(r, 900));
    const seen1 = (await listApps()).find((a: any) => a.id === 'app:loop-demo');
    check('it is listed while the loop runs', !!seen1);
    check('it reported more than once', beats.length >= 3 && beats.every((b: any) => b.ok), JSON.stringify(beats.map((b: any) => b.ok)));
    const first = Number(seen1?.lastSeenMs || 0);
    await new Promise((r) => setTimeout(r, 600));
    const seen2 = (await listApps()).find((a: any) => a.id === 'app:loop-demo');
    check('lastSeenMs moves forward (the beat renews the entry)', Number(seen2?.lastSeenMs || 0) > first, `${first} -> ${seen2?.lastSeenMs}`);
    stop.abort(); await done;
    check('stopping the loop releases the entry at once', !(await listApps()).some((a: any) => a.id === 'app:loop-demo'));
  }

  console.log('\n[4] the CLI');
  {
    const r = await cli(['attach', 'cli-demo', '--port', String(appPort), '--title', 'CLI', '--entry', 'vite', '--once', '--json']);
    const line = r.out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop() || '{}';
    let parsed: any = {}; try { parsed = JSON.parse(line); } catch { /* shown below */ }
    check('attach --once --json exits 0 and says ok', r.code === 0 && parsed.ok === true && parsed.id === 'app:cli-demo', `${r.code} ${r.out.slice(-300)}`);
    const found = (await listApps()).find((a: any) => a.id === 'app:cli-demo');
    check('the app is listed with its title and entry', !!found && found.metadata?.title === 'CLI' && found.metadata?.entry === 'vite', JSON.stringify(found));
    const d = await cli(['detach', 'cli-demo', '--json']);
    check('detach --json exits 0', d.code === 0, `${d.code} ${d.out.slice(-200)}`);
    check('and the app is gone', !(await listApps()).some((a: any) => a.id === 'app:cli-demo'));
    const bad = await cli(['attach', 'cli-dead', '--port', String(deadPort), '--once', '--json']);
    check('attach on a dead port exits non-zero', bad.code !== 0, `${bad.code} ${bad.out.slice(-200)}`);
    const badName = await cli(['attach', '../x', '--port', String(appPort), '--once', '--json']);
    check('attach with a bad name exits non-zero and sends nothing', badName.code !== 0 && !(await listApps()).some((a: any) => String(a.name).includes('x')), `${badName.code}`);
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('app attach probe complete');
