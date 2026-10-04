// gateway-app-registry-verification.test.ts
//
// /apps/report, /apps/release, /apps/restart-all. Found live 2026-10-03
// (same audit pass as the catalog upsert/spawn fix, requested afterward):
// report_app() stored whatever `port` a caller sent with zero verification,
// and restart_all() later ran `lsof -ti tcp:<port>` + `kill -TERM` against
// it. A loopback-only caller (the same browser-mediated CSRF everything
// else in this file closes) could register an attacker-chosen port
// belonging to a completely unrelated process and have restart-all
// terminate it -- a confused-deputy: the service trusted a self-reported
// claim ("this port is mine") with no evidence behind it.
//
// Live-tested against a real "victim" process (a throwaway Node HTTP
// server, nothing to do with netget) before this fix: registering its real
// port and calling restart-all did NOT kill it in that test run, but only
// because lsof wasn't resolvable from io.popen()'s minimal /bin/sh PATH in
// that environment -- a separate, unrelated bug, not a safeguard. Treating
// that as "not exploitable" would have been wrong: a different install with
// lsof reachable (or a fixed PATH) would have killed it for real. This fix
// does not rely on lsof being broken.
//
// Fix: probe_monad_surface(port) (apps.lua) confirms a claimed port is
// actually answering as a real monad surface (GET /__surface, checked for a
// real monadId) before report_app() accepts it, AND restart_all()
// re-verifies fresh immediately before each kill (closing the TOCTOU window
// a registration-time-only check would leave open -- a port can go quiet
// and be reassigned between heartbeats). This does not perform full claim
// signature verification (gap #1/#2 in CLAUDE.md, explicitly future work);
// what it closes is simpler and immediate: an arbitrary, unrelated local
// process can no longer be registered or restarted just by naming its port
// -- the port must actually speak the monad surface protocol, checked live,
// not merely be claimed.
//
// This file proves, entirely on disposable infra: an unverified port is
// rejected by /apps/report and never reaches the registry; a real throwaway
// monad's own port passes; restart-all leaves an unrelated real process
// alone (confirmed with an actual separate OS process, a genuine PID,
// listening on a real port) and only terminates a genuine, currently-live
// monad surface.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-registry-verify-'));
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

const netgetTsRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';
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

let pass = 0; let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
};

try {
  await startNginx();

  console.log('\n[1] /apps/report rejects a port that does not speak the monad surface protocol');
  {
    const r = await call('GET', '/apps/report');
    check('GET /apps/report -> 405 (method gated)', r.status === 405, JSON.stringify(r.json));
  }
  {
    const fakePort = await freePort(); // a real free port, but nothing is listening there at all
    const r = await call('POST', '/apps/report', { id: 'fake-1', name: 'nothing-here', port: fakePort });
    check('port with nothing listening -> 422 PORT_NOT_VERIFIED', r.status === 422 && r.json.error === 'PORT_NOT_VERIFIED', JSON.stringify(r.json));
  }
  {
    // A real throwaway HTTP server that answers, but NOT with a monad-shaped /__surface.
    const victimPort = await freePort();
    const victim = spawn('node', ['-e', `require('http').createServer((q,r)=>r.end('not a monad')).listen(${victimPort},'127.0.0.1',()=>console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise<void>((resolve, reject) => {
      let out = ''; victim.stdout!.on('data', (d) => { out += d; if (out.includes('up')) resolve(); });
      victim.on('error', reject); setTimeout(() => reject(new Error('timeout')), 5000);
    });
    const r = await call('POST', '/apps/report', { id: 'victim-1', name: 'unrelated-service', port: victimPort });
    check('a real process that is NOT a monad surface -> 422 PORT_NOT_VERIFIED', r.status === 422 && r.json.error === 'PORT_NOT_VERIFIED', JSON.stringify(r.json));
    victim.kill();
  }

  console.log('\n[2] /apps/report accepts a real monad\'s own port, verified live');
  {
    const r = await call('POST', '/apps/report', { id: 'real-monad-1', name: 'registry-verify-monad', port: monadPort });
    check('reporting the REAL disposable monad\'s own port -> 200', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
  }
  {
    const r = await call('GET', '/apps');
    const found = (r.json.apps || []).find((a: any) => a.id === 'real-monad-1');
    check('it is now in the registry, with its verified monadId recorded', !!found && typeof found.verifiedMonadId === 'string' && found.verifiedMonadId.length > 0, JSON.stringify(found));
  }
  // Release it again immediately -- this monad runs IN this same test
  // process (app.listen(), not a child process), so it must never actually
  // be a restart-all target: that would send SIGTERM to this test script's
  // own PID. Step 4 below uses a genuine, separate child process instead to
  // test the positive (should-be-killed) case safely.
  await call('POST', '/apps/release', { id: 'real-monad-1' });

  console.log('\n[3] restart-all only terminates what is CURRENTLY live and verified -- an unrelated real process survives');
  const unrelatedPort = await freePort();
  const unrelated = spawn('node', ['-e', `require('http').createServer((q,r)=>r.end('alive')).listen(${unrelatedPort},'127.0.0.1',()=>console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const unrelatedPid = unrelated.pid!;
  await new Promise<void>((resolve, reject) => {
    let out = ''; unrelated.stdout!.on('data', (d) => { out += d; if (out.includes('up')) resolve(); });
    unrelated.on('error', reject); setTimeout(() => reject(new Error('timeout')), 5000);
  });
  let unrelatedExited = false;
  unrelated.on('exit', () => { unrelatedExited = true; });
  console.log(`  unrelated real process: pid=${unrelatedPid} port=${unrelatedPort} (genuinely not netget-managed)`);

  // Force it into the registry via a DIRECT file write (bypassing report_app's
  // own live check) -- this simulates a stale/historical registry entry (or
  // one from a time report_app's own gate had not yet been added), so that
  // restart_all's OWN fresh re-check is what's actually under test here, not
  // report_app's.
  const appsPath = path.join(dataDir, 'runtime', 'apps.json');
  const registry = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
  registry.apps['stale-unverified-entry'] = { id: 'stale-unverified-entry', name: 'stale', port: unrelatedPort, lastSeenMs: Date.now(), localOnly: true };
  fs.writeFileSync(appsPath, JSON.stringify(registry));

  const restartRes = await call('POST', '/apps/restart-all', {});
  console.log(`  /apps/restart-all -> ${restartRes.status} ${JSON.stringify(restartRes.json)}`);
  await new Promise((r) => setTimeout(r, 500));
  check('the unrelated real process was NOT killed', !unrelatedExited);
  check('restart-all reports it as skipped, not restarted', (restartRes.json.skipped || []).some((s: any) => s.port === unrelatedPort));
  try { unrelated.kill(); } catch { /* already gone if this assertion is wrong */ }

  console.log('\n[4] restart-all DOES terminate a currently-live, genuinely-verified monad surface');
  // A genuine, SEPARATE child process (its own PID, unlike the in-process
  // monad above) that answers /__surface with a real-shaped monadId --
  // enough for probe_monad_surface() to accept it, without risking this
  // test script's own process.
  const fakeMonadPort = await freePort();
  const fakeMonadScript = `
    require('http').createServer((req, res) => {
      if (req.url === '/__surface') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ monadId: 'monad:fake-for-restart-all-positive-case' }));
      } else {
        res.end('ok');
      }
    }).listen(${fakeMonadPort}, '127.0.0.1', () => console.log('FAKE_MONAD_READY'));
  `;
  const fakeMonadProc = spawn('node', ['-e', fakeMonadScript], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise<void>((resolve, reject) => {
    let out = ''; fakeMonadProc.stdout!.on('data', (d) => { out += d; if (out.includes('FAKE_MONAD_READY')) resolve(); });
    fakeMonadProc.on('error', reject); setTimeout(() => reject(new Error('timeout')), 5000);
  });
  let fakeMonadExited = false;
  fakeMonadProc.on('exit', () => { fakeMonadExited = true; });
  {
    const r = await call('POST', '/apps/report', { id: 'fake-monad-2', name: 'restart-target', port: fakeMonadPort });
    check('reporting the separate fake-monad process -> 200 (it genuinely answers /__surface)', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
  }
  {
    const r = await call('POST', '/apps/restart-all', {});
    console.log(`  /apps/restart-all -> ${r.status} ${JSON.stringify(r.json)}`);
    const restartedIt = (r.json.restarted || []).some((x: any) => x.port === fakeMonadPort);
    check('restart-all reports it as restarted', restartedIt, JSON.stringify(r.json));
    await new Promise((resolve) => setTimeout(resolve, 500));
    check('the fake-monad process actually received SIGTERM and exited', fakeMonadExited);
  }
  if (!fakeMonadExited) { try { fakeMonadProc.kill(); } catch { /* already gone */ } }

  console.log('\n[5] /apps/release requires POST');
  {
    const r = await call('GET', '/apps/release');
    check('GET /apps/release -> 405', r.status === 405, JSON.stringify(r.json));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('registry verification probe complete');
