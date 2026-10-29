// gateway-app-attach.test.ts
//
// An app that is ALREADY running lists itself with attachExisting() (src/netget.ts) -- the registration netget() sends,
// without leasing a port the app already holds -- and `netget attach` / `netget detach` are thin commands on top of it
// (src/gateway/attach.ts). Against a disposable gateway (an OpenResty on high ports with this repo's Lua);
// gateway-app-registration.test.ts proves what the gateway keeps, this proves what an app and the CLI send:
//   [1] the name and port are validated before anything is sent; the name is used exactly (no rewriting);
//   [2] attachExisting lists the app under `app:<name>` with no lease; netget() itself cannot take that port (the reason
//       attachExisting exists); a dead port is a refusal that heals on the next beat, and strict mode makes it an error;
//   [3] the heartbeat renews the entry; stop() releases it at once;
//   [4] the CLI: `attach --once --json` lists, a long-running `attach` lists and takes itself out on SIGTERM,
//       `detach` finds an app by NAME (also one that registered through netget() under its lease id), bad input exits non-zero.
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

const { netget, attachExisting, validateAttachName } = await import(path.join(netgetTsRoot, 'src/netget.ts'));
const mainServer = `http://localhost:${HTTP_PORT}`;
const listApps = async () => (await call('GET', '/apps')).json.apps || [];
const listen = (port: number): Promise<http.Server> => new Promise((resolve) => { const s = http.createServer((q, r) => r.end('app')); s.listen(port, '127.0.0.1', () => resolve(s)); });
const server = await listen(0);
const appPort = (server.address() as any).port;
const deadPort = await freePort();
const cli = (args: string[]): Promise<{ code: number | null; out: string }> => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--import', 'tsx', path.join(netgetTsRoot, 'src/netget.cli.ts'), ...args], {
    env: { ...process.env, NETGET_LOCAL: mainServer, NETGET_DATA_DIR: dataDir, HOME: home }, cwd: netgetTsRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  await startNginx();

  console.log('\n[1] the name and the port are validated before anything is sent');
  {
    check('a name with a dot is a good name (polls.studio)', validateAttachName('polls.studio') === null);
    for (const [label, name, port] of [
      ['an empty name', '', 4100], ['a path as a name', '../etc', 4100], ['a name with a space', 'my app', 4100],
      ['an uppercase name (it is not silently rewritten)', 'FullTrailer', 4100], ['port 0', 'a', 0], ['a port past 65535', 'a', 70000], ['a fractional port', 'a', 80.5],
    ] as const) {
      check(`${label} is refused, nothing is sent`, await rejects(() => attachExisting({ name, port, mainServer })));
    }
    check('a remote netget is refused (apps report to the local netget only)', await rejects(() => attachExisting({ name: 'a', port: 4100, mainServer: 'http://example.com' })));
    check('nothing reached the registry', (await listApps()).length === 0);
  }

  console.log('\n[2] attachExisting lists an app that already holds its port');
  {
    check('netget() cannot take a port somebody already listens on (fixed mode throws): that is why attachExisting exists',
      await rejects(() => netget({ name: 'taken', port: appPort, mode: 'fixed', mainServer, strict: true })));
    const session = await attachExisting({ name: 'polls.studio', port: appPort, mainServer, heartbeatMs: 1000, metadata: { title: 'Polls', entry: 'dist' } });
    check('the session has no lease and keeps the exact name', session.lease === undefined && session.name === 'polls.studio' && session.id === 'app:polls.studio', JSON.stringify([session.name, session.id]));
    const found = (await listApps()).find((a: any) => a.id === 'app:polls.studio');
    check('it is listed under app:polls.studio as an app on its port', !!found && found.kind === 'app' && found.name === 'polls.studio' && found.port === appPort, JSON.stringify(found));
    check('its port status says it is not leased', !!found && found.portStatus === undefined && found.leaseId === undefined, JSON.stringify(found));
    const leases = path.join(home, '.get', 'runtime', 'ports');
    check('no port lease was written for it', !fs.existsSync(leases) || !fs.readdirSync(leases).some((f) => f.includes('polls')), fs.existsSync(leases) ? fs.readdirSync(leases).join(',') : '(no dir)');
    await session.stop();
    check('stop() releases the entry at once', !(await listApps()).some((a: any) => a.id === 'app:polls.studio'));
  }
  {
    check('strict + a dead port -> an error (the gate says PORT_NOT_ANSWERING)', await rejects(() => attachExisting({ name: 'late', port: deadPort, mainServer, strict: true })));
    const seen: Array<Error | null> = [];
    const late = await attachExisting({ name: 'late', port: deadPort, mainServer, heartbeatMs: 1000, onReport: (e: Error | null) => seen.push(e) });
    check('not strict + a dead port -> resolves, nothing is listed, onReport saw the refusal', seen.length >= 1 && seen[0] instanceof Error && /PORT_NOT_ANSWERING/.test(seen[0]!.message) && !(await listApps()).some((a: any) => a.id === 'app:late'), String(seen[0]));
    const lateServer = await listen(deadPort);
    await sleep(1500);
    check('the app starts later: the next heartbeat lists it, onReport saw it succeed', (await listApps()).some((a: any) => a.id === 'app:late') && seen[seen.length - 1] === null, JSON.stringify(seen.map((e) => (e ? 'err' : 'ok'))));
    await late.stop(); lateServer.close();
  }

  console.log('\n[3] the heartbeat renews the entry; stop() releases it');
  {
    const beats: Array<Error | null> = [];
    const live = await attachExisting({ name: 'loop-demo', port: appPort, mainServer, heartbeatMs: 1000, onReport: (e: Error | null) => beats.push(e) });
    const first = Number((await listApps()).find((a: any) => a.id === 'app:loop-demo')?.lastSeenMs || 0);
    await sleep(2300);
    const seen2 = (await listApps()).find((a: any) => a.id === 'app:loop-demo');
    check('it reported more than once, all accepted', beats.length >= 3 && beats.every((b) => b === null), JSON.stringify(beats.map((b) => (b ? 'err' : 'ok'))));
    check('lastSeenMs moves forward (the beat renews the entry)', Number(seen2?.lastSeenMs || 0) > first, `${first} -> ${seen2?.lastSeenMs}`);
    await live.stop();
    check('stop() released it', !(await listApps()).some((a: any) => a.id === 'app:loop-demo'));
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
    const none = await cli(['detach', 'never-listed', '--json']);
    check('detach of an app that is not listed exits non-zero', none.code !== 0, `${none.code} ${none.out.slice(-200)}`);
    const bad = await cli(['attach', 'cli-dead', '--port', String(deadPort), '--once', '--json']);
    check('attach --once on a dead port exits non-zero', bad.code !== 0, `${bad.code} ${bad.out.slice(-200)}`);
    const badName = await cli(['attach', '../x', '--port', String(appPort), '--once', '--json']);
    check('attach with a bad name exits non-zero and sends nothing', badName.code !== 0 && !(await listApps()).some((a: any) => String(a.name).includes('x')), `${badName.code}`);
  }
  {
    // the long-running command: lists, keeps the process up, takes the entry out on SIGTERM (the helper's `stop`)
    const p = spawn(process.execPath, ['--import', 'tsx', path.join(netgetTsRoot, 'src/netget.cli.ts'), 'attach', 'cli-live', '--port', String(appPort), '--title', 'Live'], {
      env: { ...process.env, NETGET_LOCAL: mainServer, NETGET_DATA_DIR: dataDir, HOME: home }, cwd: netgetTsRoot, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const closed = new Promise<number | null>((resolve) => p.on('close', resolve));
    let listed = false;
    for (let i = 0; i < 40 && !listed; i += 1) { await sleep(250); listed = (await listApps()).some((a: any) => a.id === 'app:cli-live'); }
    check('attach (no --once) lists the app and keeps running', listed && p.exitCode === null, out.slice(-200));
    await sleep(3500);
    check('and it is still listed after more than one heartbeat', (await listApps()).some((a: any) => a.id === 'app:cli-live') && p.exitCode === null);
    p.kill('SIGTERM');
    const code = await closed;
    check('SIGTERM ends it (exit 143) and the entry is taken out', code === 143 && !(await listApps()).some((a: any) => a.id === 'app:cli-live'), `${code} ${out.slice(-200)}`);
  }
  {
    // detach by NAME also finds an app that registered through netget() (listed under its lease id, not app:<name>)
    const libServer = await listen(0);
    const lib = await netget({ name: 'lib-by-name', port: 'auto', mainServer, heartbeatMs: 1000 });
    await libServer.close();
    const libPortServer = await listen(lib.port);
    await lib.report();
    check('a netget() app is listed under its lease id', (await listApps()).some((a: any) => a.id === lib.id && a.name === 'lib-by-name'));
    const d = await cli(['detach', 'lib-by-name', '--json']);
    check('detach by name releases it', d.code === 0 && !(await listApps()).some((a: any) => a.id === lib.id), `${d.code} ${d.out.slice(-200)}`);
    await lib.stop(); libPortServer.close();
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
