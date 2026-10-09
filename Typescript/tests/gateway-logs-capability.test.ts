// gateway-logs-capability.test.ts
//
// /logs. Found live 2026-10-03 (same audit pass as the other fixes in this
// branch): gated only by operator_access.is_loopback() (logs.lua's own
// verify_cookie(), a stale name for the same check), while this location's
// own CORS headers reflect any Origin with credentials. The response
// (remote_addr, the full request line including query string, referer,
// user-agent -- log_format netget_access in setNginxConfigRoutes.ts) is
// genuinely readable cross-origin: a page on ANY origin already satisfies
// "loopback" the same way every other fix in this audit pass closes (the
// browser making the request IS the loopback peer, regardless of which
// origin's script triggered it) -- and because this location reflects
// Origin with credentials, that page can also read the response back, not
// just trigger the request blindly. "Requires loopback" was not "safe" here,
// and "read-only" was not low-stakes: these are request logs.
//
// Fix: elevated to the same standard as the mutating endpoints fixed
// elsewhere in this pass -- a real X-Me-Proof (middleware/me_sig.lua) plus
// the explicit gateway:control:logs-read capability
// (lib/operator_access.lua's has_capability(), no owner/admin bypass).
// Method narrowed to GET only (the handler never had any other code path).
//
// This file proves the full chain end to end, real signed proofs, entirely
// on disposable infra: no proof is 401; a valid proof without the exact
// capability is 403 CAPABILITY_DENIED (admin alone included); the exact
// grant actually returns real log content; POST is rejected.
//
// UPDATE 2026-10-04: the query-binding gap below is now closed. me_sig.lua's
// challenge binds {method, path, query, bodyHash, nonce, timestamp}; `query`
// is the canonicalized (decoded, sorted) query string, produced identically
// by signedRequest.ts's canonicalizeQuery() client-side and me_sig.lua's
// canonicalize_query() server-side. Category [2b] below now proves the
// FIX, not the gap: a proof signed for one query no longer works for a
// different one on the same path, each case checked with its own
// independently-signed, fresh-nonce proof (never reusing one accepted proof
// across variants -- that would conflate replay-protection, already covered
// by category 1, with query-binding, which [2b] exists to prove on its
// own). An old-format proof that never signed a query field at all is still
// accepted on a route that genuinely has none ([2c]), but never silently
// accepted the moment the real request carries query parameters ([2d]) --
// this is what makes the fix a strict tightening, not a parallel escape
// hatch.
//
// (Original finding, left for context: me_sig.lua's challenge used to bind
// only {method, path, bodyHash, nonce, timestamp} -- path was checked
// against ngx.var.uri, which is path-only and never included the query
// string; a GET also has no body, so bodyHash was always sha256(""). A
// proof signed for nothing more specific than the bare path /logs therefore
// authorized "GET /logs with ANY query string," not "GET /logs?type=access
// specifically". Not a privilege escalation on its own even then -- the
// capability grant was still required for either, and a captured proof was
// still single-use per the nonce-replay protection -- but it meant "this
// proof signs the complete request" was a narrower claim than it sounded
// for any GET route gated this way. Fixed by widening me_sig.lua's own
// challenge to cover the query string -- shared middleware every
// capability-gated route in this audit pass depends on, so the fix lives
// there plus signedRequest.ts, not in any one caller.)
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-logs-jewel-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'logs-jewel.me';
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
  cwd: monadRoot, seed: 'logs-jewel-seed', namespace: 'logs-jewel.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'logs-jewel.me', selfHostname: 'logs-jewel.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
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
// Something real for logs.lua to actually read back.
fs.writeFileSync(path.join(prefix, 'logs', 'netget_access.log'), '127.0.0.1 - - [01/Jan/2026:00:00:00 +0000] "GET /sensitive-looking-path?token=abc123 HTTP/1.1" 200 12 "-" "curl"\n');
// A second, distinguishable log -- used below to check whether a proof
// signed for the bare path /logs (no query string -- me_sig.lua's challenge
// binds ngx.var.uri, which never includes one) can be used to read a
// DIFFERENT ?type= than whichever one it might have been intended for.
fs.writeFileSync(path.join(prefix, 'logs', 'netget_error.log'), '2026/01/01 00:00:00 [error] DISTINCT_ERROR_LOG_MARKER something went wrong\n');

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

// Mirrors signedRequest.ts's canonicalizeQuery() exactly: decoded key/value
// pairs, JSON-array-of-pairs encoded, in EXACT appearance order -- never
// sorted (a repeated query key's order can be operationally significant,
// see lib/query_canon.lua's header comment). Must stay byte-for-byte
// identical to the production implementation and to me_sig.lua's own
// query_canon.canonicalize() -- all three are compared with string
// equality, not semantic equality.
function canonicalizeQuery(qs: string): string {
  return JSON.stringify(Array.from(new URLSearchParams(qs).entries()));
}

async function signedRequest(node: any, hostname: string, method: string, p: string, opts: { noProof?: boolean; origin?: string; omitSignedQuery?: boolean; signedQuery?: string } = {}) {
  const [pathOnly, actualQuery = ''] = p.split('?');
  const signed: Record<string, unknown> = { method, path: pathOnly, bodyHash: sha256Hex(''), nonce: genNonce(), timestamp: Date.now() };
  // Normally sign the query that's actually being sent. Tests that need to
  // prove tampering/omission detection pass signedQuery (a DIFFERENT query
  // than what's sent) or omitSignedQuery (simulate an old-format proof that
  // never bound a query at all).
  if (!opts.omitSignedQuery) {
    signed.query = canonicalizeQuery(opts.signedQuery !== undefined ? opts.signedQuery : actualQuery);
  }
  const headers: Record<string, string> = { host: 'localhost', connection: 'close' };
  if (opts.origin) headers['origin'] = opts.origin;
  if (!opts.noProof) {
    const challenge = canonicalJson(signed);
    const proof = await node.prove({ rootNamespace: hostname, challenge });
    headers['x-me-proof'] = Buffer.from(JSON.stringify(proof)).toString('base64url');
  }
  const res: { status: number; text: string; headers: http.IncomingHttpHeaders } = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers }, (r) => {
      let text = ''; r.setEncoding('utf8'); r.on('data', (c) => { text += c; });
      r.on('end', () => resolve({ status: r.statusCode || 0, text, headers: r.headers }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
  let json: any = {}; try { json = JSON.parse(res.text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

const claimsPath = path.join(dataDir, 'runtime', 'gateway-claims.json');
function readClaims(): any {
  if (!fs.existsSync(claimsPath)) return { pubkeys: {}, grants: {}, admins: {}, usernames: {}, owner: null };
  return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
}
function writeClaims(claims: any) { fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf8'); }

let pass = 0; let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
};

try {
  await startNginx();

  const ME_RESEED = Symbol.for('me.internal.reseed');
  const me = new (ME as any)();
  (me as any)[ME_RESEED]('logs-jewel-identity', 'logs-jewel-secret-do-not-reuse');
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
    claims.usernames[identityHash] = 'logs-jewel-identity';
    if (opts.admin) claims.admins[identityHash] = true; else delete claims.admins[identityHash];
    if (opts.scopes) claims.grants[identityHash] = opts.scopes; else delete claims.grants[identityHash];
    writeClaims(claims);
  }

  console.log('\n[1] no proof, no capability -- including from a simulated cross-origin page');
  {
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?type=access', { noProof: true, origin: 'https://evil.example' });
    check('no X-Me-Proof at all -> 401, even though CORS reflects the Origin', r.status === 401, JSON.stringify(r.json));
    check('Access-Control-Allow-Origin IS reflected (confirms the cross-origin read path this closes is real)', r.headers['access-control-allow-origin'] === 'https://evil.example', r.headers);
  }
  {
    anchor({});
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?type=access');
    check('valid proof, NO capability -> 403 CAPABILITY_DENIED', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
  }
  {
    anchor({ admin: true });
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?type=access');
    check('admin alone -> still 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
  }

  console.log('\n[2] the exact grant returns real log content');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?type=access');
    check('valid proof + exact grant -> 200', r.status === 200, JSON.stringify(r.json));
    check('real log content comes back', Array.isArray(r.json.logs) && r.json.logs.some((l: string) => l.includes('sensitive-looking-path')), JSON.stringify(r.json));
  }

  // The fix: the query string is now part of what me_sig.lua's challenge
  // binds. Each case below is its own independently-signed request with its
  // own fresh nonce (signedRequest() calls genNonce() internally every
  // time it's invoked) -- never one proof reused across variants, so a
  // failure here proves query-binding specifically, not replay-protection
  // (already covered by category 1).
  console.log('\n[2b] query tampering after signing invalidates the proof -- each case its own fresh-nonce request');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const rCorrect = await signedRequest(node, 'localhost', 'GET', '/logs?type=access');
    check('correctly-matching request (signed query == sent query) -> 200, real access log', rCorrect.status === 200 && Array.isArray(rCorrect.json.logs) && rCorrect.json.logs.some((l: string) => l.includes('sensitive-looking-path')), JSON.stringify(rCorrect.json));

    const rModified = await signedRequest(node, 'localhost', 'GET', '/logs?type=access', { signedQuery: 'type=error' });
    check('MODIFIED param (signed for ?type=error, sent as ?type=access) -> 401 ME_PROOF_QUERY_MISMATCH', rModified.status === 401 && rModified.json.error === 'ME_PROOF_QUERY_MISMATCH', JSON.stringify(rModified.json));

    const rAdded = await signedRequest(node, 'localhost', 'GET', '/logs?type=access&extra=1', { signedQuery: 'type=access' });
    check('ADDED param (signed for ?type=access, sent as ?type=access&extra=1) -> 401 ME_PROOF_QUERY_MISMATCH', rAdded.status === 401 && rAdded.json.error === 'ME_PROOF_QUERY_MISMATCH', JSON.stringify(rAdded.json));

    const rRemoved = await signedRequest(node, 'localhost', 'GET', '/logs?type=access', { signedQuery: 'type=access&extra=1' });
    check('REMOVED param (signed for ?type=access&extra=1, sent as ?type=access) -> 401 ME_PROOF_QUERY_MISMATCH', rRemoved.status === 401 && rRemoved.json.error === 'ME_PROOF_QUERY_MISMATCH', JSON.stringify(rRemoved.json));

    // The exact exploit this whole category used to demonstrate: a proof
    // signed for ?type=access must NOT also work for ?type=error.
    const rCrossResource = await signedRequest(node, 'localhost', 'GET', '/logs?type=error', { signedQuery: 'type=access' });
    check('a proof signed for ?type=access can no longer read ?type=error -> 401 ME_PROOF_QUERY_MISMATCH (the original gap, now closed)', rCrossResource.status === 401 && rCrossResource.json.error === 'ME_PROOF_QUERY_MISMATCH', JSON.stringify(rCrossResource.json));
  }

  console.log('\n[2c] an old-format proof (no query field at all) still works on a route with genuinely no query string');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const r = await signedRequest(node, 'localhost', 'GET', '/logs', { omitSignedQuery: true });
    check('no query field signed, no query sent -> 200 (backward compatible)', r.status === 200, JSON.stringify(r.json));
  }

  console.log('\n[2d] an old-format proof (no query field) is NOT silently accepted when the real request DOES carry query parameters');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?type=access', { omitSignedQuery: true });
    check('no query field signed, but request has ?type=access -> 401 ME_PROOF_QUERY_UNBOUND (not silently accepted)', r.status === 401 && r.json.error === 'ME_PROOF_QUERY_UNBOUND', JSON.stringify(r.json));
  }

  console.log('\n[2e] a correctly re-signed request for each distinct query still succeeds -- the fix narrows, it does not break legitimate use');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const rAccess = await signedRequest(node, 'localhost', 'GET', '/logs?type=access');
    check('freshly, correctly signed ?type=access -> 200, real access log', rAccess.status === 200 && Array.isArray(rAccess.json.logs) && rAccess.json.logs.some((l: string) => l.includes('sensitive-looking-path')), JSON.stringify(rAccess.json));
    const rError = await signedRequest(node, 'localhost', 'GET', '/logs?type=error');
    check('freshly, correctly signed ?type=error -> 200, real error log (a genuinely different, correctly-authorized resource)', rError.status === 200 && Array.isArray(rError.json.logs) && rError.json.logs.some((l: string) => l.includes('DISTINCT_ERROR_LOG_MARKER')), JSON.stringify(rError.json));
  }

  // End-to-end confirmation of lib/query_canon.lua's invalid-UTF-8 path
  // through the REAL me_sig.lua verify_request() chain (not just the
  // isolated module -- see gateway-query-canonicalization.test.ts for
  // that), with a genuinely valid admin+capability grant in place: proves
  // the full request path fails closed with a clean, documented status,
  // never an uncaught Lua error. signedRequest()'s own canonicalizeQuery()
  // (mirroring the client) substitutes U+FFFD for the invalid bytes when
  // building what it signs -- irrelevant here, since the server rejects
  // based on the REAL wire query string before ever comparing it.
  console.log('\n[2f] a query that decodes to invalid UTF-8 is rejected cleanly end-to-end, even with a fully valid proof + capability');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const r = await signedRequest(node, 'localhost', 'GET', '/logs?bad=%FF');
    check('invalid UTF-8 in the real query -> 401 ME_PROOF_QUERY_INVALID_ENCODING, not a 500, not silently compared', r.status === 401 && r.json.error === 'ME_PROOF_QUERY_INVALID_ENCODING', JSON.stringify(r.json));
  }

  console.log('\n[3] POST is rejected');
  {
    anchor({ admin: true, scopes: ['gateway:control:logs-read'] });
    const r = await signedRequest(node, 'localhost', 'POST', '/logs?type=access');
    check('POST (even with the read grant) -> 405', r.status === 405, JSON.stringify(r.json));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('logs capability probe complete');
