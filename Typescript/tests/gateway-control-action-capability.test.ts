// gateway-control-action-capability.test.ts
//
// /openresty-restart, /openresty-stop, /dev-server-start, /dev-server-stop
// (process control: can shut down or restart this machine's gateway / its
// local dev server) used operatorOnly's `limit_except GET HEAD OPTIONS {
// allow 127.0.0.1; allow ::1; deny all; }` as their only gate. Two real bugs
// found live, 2026-10-03, isolated with a minimal standalone nginx config
// varying one directive at a time:
//
//   1. GET/HEAD are exempt from limit_except's method list, so they are not
//      restricted by it at all -- a bare GET from loopback, no credential of
//      any kind, executed the action. Confirmed on disposable infra: before
//      this fix, `GET /openresty-restart` from 127.0.0.1 returned 200 and
//      actually ran `netget reload --json`.
//   2. limit_except also broke the INTENDED method: POST (the one actually
//      listed as allowed) never reached content_by_lua_file/
//      content_by_lua_block/a plain `return` for a method outside its own
//      list -- nginx fell through to its default (static-file) content
//      handler instead, which 404s. proxy_pass is unaffected (confirmed in
//      the same isolation), which is why /add-domain and friends, which all
//      proxy_pass to the monad, never hit this. So these four actions were
//      simultaneously open to GET with zero auth, AND broken for their own
//      intended POST+loopback operator flow.
//
// Fix (setNginxConfigRoutes.ts's controlActionGate, replacing operatorOnly
// for just these four locations): OPTIONS answers the CORS preflight only;
// any other non-POST method is rejected with 405 before any IP or identity
// check runs; POST is then gated by a bare (non-limit_except, confirmed safe
// for content_by_lua_file) allow/deny restricted to this machine; then
// middleware/me_sig.lua -- the same Ed25519 X-Me-Proof verification
// /domains/metadata already uses -- verifies the caller's identity.
// openresty.lua/dev_server.lua make the actual capability decision (see
// lib/operator_access.lua's has_capability()): loopback is necessary but, on
// its own, no longer sufficient.
//
// This file proves that chain end to end, real signed proofs (this.me +
// cleaker, the same path useCleakerAuth.ts's signedFetch uses -- not a
// header shortcut), entirely on a fresh temp OpenResty + monad + stub
// `netget` (so a refusal that regressed could never stop this machine's own
// gateway) -- never the real ambient gateway, never ~/.get. Mirrors
// gateway-capability-model.test.ts's own "jewel" shape (admin alone isn't
// enough; an explicit, exact grant is) for a different capability family
// that has no daemon in its path to defer the decision to.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ME from 'this.me';
import cleaker from 'cleaker';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-jewel-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
const stubDir = path.join(tmp, 'bin'); fs.mkdirSync(stubDir);
const ranLog = path.join(tmp, 'netget-ran.log');
fs.writeFileSync(path.join(stubDir, 'netget'), `#!/bin/sh\necho "$@" >> "${ranLog}"\necho '{"ok":true,"stub":true}'\n`, { mode: 0o755 });
const ran = () => (fs.existsSync(ranLog) ? fs.readFileSync(ranLog, 'utf8').trim().split('\n').filter(Boolean) : []);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'jewel-probe.me';
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
  cwd: monadRoot, seed: 'jewel-probe-seed', namespace: 'jewel-probe.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'jewel-probe.me', selfHostname: 'jewel-probe.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
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

// ── signing helpers, mirrored verbatim from gateway-capability-model.test.ts ──
function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
}
function genNonce(): string { return crypto.randomBytes(16).toString('hex'); }
function sha256Hex(data: string): string { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

type Overrides = { method?: string; path?: string; bodyHash?: string; nonce?: string; timestamp?: number };
async function signedRequest(node: any, hostname: string, actualMethod: string, actualPath: string, overrides: Overrides = {}) {
  const bodyStr = '';
  const signed = {
    method: overrides.method ?? actualMethod,
    path: overrides.path ?? actualPath,
    bodyHash: overrides.bodyHash ?? sha256Hex(bodyStr),
    nonce: overrides.nonce ?? genNonce(),
    timestamp: overrides.timestamp ?? Date.now(),
  };
  const challenge = canonicalJson(signed);
  const proof = await node.prove({ rootNamespace: hostname, challenge });
  const proofB64 = Buffer.from(JSON.stringify(proof)).toString('base64url');
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}${actualPath}`, {
    method: actualMethod,
    headers: { 'Content-Type': 'application/json', 'X-Me-Proof': proofB64, Host: 'localhost' },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const claimsPath = path.join(dataDir, 'runtime', 'gateway-claims.json');
function readClaims(): any {
  if (!fs.existsSync(claimsPath)) return { pubkeys: {}, grants: {}, admins: {}, usernames: {}, owner: null };
  return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
}
function writeClaims(claims: any) { fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf8'); }

const bareGet = (p: string, method = 'GET'): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers: { host: 'localhost' } }, (res) => {
    let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode || 0, text }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
  req.end();
});

try {
  await startNginx();

  // ── identity: real this.me + cleaker, exactly the production signing path ──
  const ME_RESEED = Symbol.for('me.internal.reseed');
  const me = new (ME as any)();
  (me as any)[ME_RESEED]('jewel-test-identity', 'jewel-test-secret-do-not-reuse');
  const node = cleaker(me as any, 'localhost');
  const idProof = await node.prove({ rootNamespace: 'localhost', challenge: null });
  const identityHash = idProof.identityHash;
  const publicKey = idProof.publicKey;
  console.log('test identity:', identityHash);

  function anchor(opts: { owner?: boolean; admin?: boolean; scopes?: string[] } = {}) {
    const claims = readClaims();
    claims.pubkeys = claims.pubkeys || {};
    claims.grants = claims.grants || {};
    claims.admins = claims.admins || {};
    claims.usernames = claims.usernames || {};
    claims.pubkeys[identityHash] = publicKey;
    claims.usernames[identityHash] = 'jewel-test-identity';
    if (opts.owner) claims.owner = identityHash; else if (claims.owner === identityHash) claims.owner = null;
    if (opts.admin) claims.admins[identityHash] = true; else delete claims.admins[identityHash];
    if (opts.scopes) claims.grants[identityHash] = opts.scopes; else delete claims.grants[identityHash];
    writeClaims(claims);
  }

  let pass = 0; let fail = 0;
  const check = (label: string, cond: boolean, detail?: unknown) => {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
  };

  // ═══ GET/HEAD never execute, with or without a valid proof ═══
  console.log('\n[1] GET/HEAD never execute the action');
  {
    const before = ran().length;
    const r = await bareGet('/openresty-restart', 'GET');
    check('plain GET, no proof, no claim at all -> 405', r.status === 405, r.status);
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ owner: true }); // even the real owner -- method is checked before anything else
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'GET', '/openresty-restart');
    check('GET with a VALID owner proof -> still 405 (method checked first)', r.status === 405, r.status);
    check('nothing ran', ran().length === before);
  }

  // ═══ POST: no proof at all ═══
  console.log('\n[2] POST without a proof');
  {
    anchor({}); // no owner, no admin, no grants
    const before = ran().length;
    const r = await bareGet('/openresty-restart', 'POST');
    check('POST, no X-Me-Proof header at all -> 401', r.status === 401, JSON.stringify(r.text));
    check('nothing ran', ran().length === before);
  }

  // ═══ 3. Capability separation -- the jewel itself ═══
  console.log('\n[3] Capability separation');
  {
    anchor({}); // authenticated (anchored pubkey) but no owner, no admin, no grant
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-restart');
    check('valid proof, NO capability at all -> 403 CAPABILITY_DENIED (the jewel)', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ admin: true }); // admin, still no explicit grant
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-restart');
    check('valid proof, admin:true but NO grant -> still 403 (admin alone is not enough)', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ admin: true, scopes: ['gateway:control:dev-server-start'] }); // a real, different capability
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-restart');
    check('valid proof, admin + an UNRELATED grant -> still 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ admin: true, scopes: ['gateway:control:openresty-restart'] });
    const before = ran();
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-restart');
    check('valid proof, admin + the EXACT grant -> 200', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
    const after = ran();
    check('exactly one action ran, and it is the right one', after.length === before.length + 1 && after[after.length - 1] === 'reload --json', after);
  }
  {
    // Deliberately NOT a free pass: the daemon's own /domains/metadata check
    // (localNetget.js) has no owner exception at all -- scopes come only
    // from the identity's claims.grants entry. has_capability() matches
    // that exactly, so even the gateway's owner needs the explicit grant.
    anchor({ owner: true });
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-stop');
    check('valid proof, OWNER but NO explicit grant -> still 403 (no owner bypass, matches the daemon)', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ owner: true, scopes: ['gateway:control:openresty-stop'] });
    const before = ran();
    const r = await signedRequest(node, 'localhost', 'POST', '/openresty-stop');
    check('valid proof, OWNER WITH the explicit grant -> 200', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
    const after = ran();
    check('exactly one action ran, and it is the right one', after.length === before.length + 1 && after[after.length - 1] === 'stop', after);
  }

  // ═══ 4. dev-server-start/stop mirror the same model ═══
  console.log('\n[4] dev-server-start mirrors the same model');
  {
    anchor({ admin: true, scopes: [] });
    const before = ran().length;
    const r = await signedRequest(node, 'localhost', 'POST', '/dev-server-start');
    check('admin, no grant -> 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
    check('nothing ran', ran().length === before);
  }
  {
    anchor({ admin: true, scopes: ['gateway:control:dev-server-start'] });
    const before = ran();
    const r = await signedRequest(node, 'localhost', 'POST', '/dev-server-start');
    check('admin + exact grant -> 200', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
    const after = ran();
    check('exactly one action ran', after.length === before.length + 1 && after[after.length - 1] === 'dev-server-start', after);
  }

  // ═══ 5. loopback is still NECESSARY, not just the capability check ═══
  console.log('\n[5] Loopback still required even with a perfect proof + capability');
  {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (lan) {
      anchor({ owner: true, scopes: ['gateway:control:openresty-restart'] }); // the exact grant, so only the IP gate is under test here
      const before = ran().length;
      // Same signing machinery, but the TCP connection itself goes out the LAN
      // interface instead of loopback -- proves the IP gate is still load-bearing,
      // not superseded by the proof check.
      const bodyStr = '';
      const signed = { method: 'POST', path: '/openresty-restart', bodyHash: sha256Hex(bodyStr), nonce: genNonce(), timestamp: Date.now() };
      const proof = await node.prove({ rootNamespace: 'localhost', challenge: canonicalJson(signed) });
      const proofB64 = Buffer.from(JSON.stringify(proof)).toString('base64url');
      const r: { status: number } = await new Promise((resolve, reject) => {
        const req = http.request({ host: lan, port: HTTP_PORT, method: 'POST', path: '/openresty-restart', timeout: 8000,
          headers: { host: 'localhost', 'content-type': 'application/json', 'x-me-proof': proofB64 } }, (res) => {
          res.on('data', () => {}); res.on('end', () => resolve({ status: res.statusCode || 0 }));
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end();
      });
      check('owner, valid proof, exact capability, but from a LAN peer -> still blocked (403)', r.status === 403, r.status);
      check('nothing ran', ran().length === before);
    } else {
      console.log('  (skipped: no LAN address on this machine)');
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('jewel probe complete');
