// verify-query-binding-backward-compat.ts
//
// Empirical, not inspection-based, proof that a NEW-format signed proof
// (one whose challenge includes `query`, per signedRequest.ts's
// canonicalizeQuery()) is accepted by the OLD middleware/me_sig.lua
// (commit ab1b2cb, the version deployed before the query-binding fix) --
// this is what makes "deploy GUI first, netget second" actually safe,
// not merely argued from reading the old file's logic.
//
// Run before deploying GUI's query-binding change (e97ab9fa) to a gateway
// still running netget's OLD verifier -- see
// docs/AdminRoutesAuditDeployment2026-10.md §2. Entirely disposable
// infra (fresh temp OpenResty + fresh monad, the OLD lua tree extracted
// via `git archive`, never the real ambient gateway); does not reopen or
// extend the audit -- it adds no new behavior, only confirms this one
// compatibility claim the way every other claim in this audit was
// confirmed: by actually running it.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawn } from 'node:child_process';
import ME from 'this.me';
import cleaker from 'cleaker';

const OLD_VERIFIER_COMMIT = 'ab1b2cb';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const netgetTsRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-backward-compat-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'backward-compat.me';
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

const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad'); fs.mkdirSync(monadRoot, { recursive: true });
const modulePath = path.resolve(netgetTsRoot, 'src/gateway/monadModule.mjs');
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'backward-compat-seed', namespace: 'backward-compat.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'backward-compat.me', selfHostname: 'backward-compat.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const monadOrigin = `http://127.0.0.1:${(monad.address() as any).port}`;
process.env.NETGET_MONAD_ORIGIN = monadOrigin;
process.env.NETGET_GATEWAY_UPSTREAM = monadOrigin;

// Nginx config generation (routes/structure) comes from the CURRENT
// working tree -- only the lua/ directory itself (the actual verifier
// code under test) is swapped for the OLD version below. The route
// wiring (location blocks, $NETGET_LUA_DIR, etc.) did not change between
// ab1b2cb and now in a way that affects this check.
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

// THE actual thing under test: the OLD lua tree, extracted via git
// archive from the commit immediately before the query-binding fix --
// not the current working tree's lua/, and not hand-reconstructed.
// `git archive -o <path>` refuses an output path outside the repo
// (confirmed live: "is outside repository") -- piping into `tar -x`
// directly avoids writing an intermediate archive file at all.
const oldLuaExtractDir = path.join(tmp, 'old-lua-extract');
fs.mkdirSync(oldLuaExtractDir, { recursive: true });
execSync(
  `git -C ${JSON.stringify(netgetTsRoot)} archive ${OLD_VERIFIER_COMMIT} -- src/modules/NetGetX/OpenResty/lua | tar -x -C ${JSON.stringify(oldLuaExtractDir)}`,
  { shell: '/bin/sh' },
);
fs.cpSync(path.join(oldLuaExtractDir, 'src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

// Confirm what we actually extracted is genuinely the pre-fix version --
// fail loudly here rather than silently "pass" a check that accidentally
// ran against the current (already-fixed) verifier.
const extractedMeSig = fs.readFileSync(path.join(prefix, 'lua', 'middleware', 'me_sig.lua'), 'utf8');
assert.ok(!extractedMeSig.includes('ME_PROOF_QUERY_MISMATCH'), 'extracted me_sig.lua is NOT the old, pre-query-binding version -- aborting rather than giving a false pass');
console.log(`confirmed: testing against the real OLD me_sig.lua from ${OLD_VERIFIER_COMMIT} (no ME_PROOF_QUERY_MISMATCH present)`);

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

// Real log files for /logs to actually read, same as
// gateway-logs-capability.test.ts.
fs.writeFileSync(path.join(prefix, 'logs', 'netget_access.log'), '127.0.0.1 - - [01/Jan/2026:00:00:00 +0000] "GET /sensitive-looking-path HTTP/1.1" 200 12 "-" "curl"\n');

// The NEW signer's exact algorithm (signedRequest.ts's canonicalizeQuery(),
// post e97ab9fa): decoded pairs, UNSORTED (appearance order), JSON array
// of pairs.
function canonicalizeQuery(qs: string): string {
  return JSON.stringify(Array.from(new URLSearchParams(qs).entries()));
}
function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
}
function genNonce(): string { return crypto.randomBytes(16).toString('hex'); }
function sha256Hex(data: string): string { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

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
  (me as any)[ME_RESEED]('backward-compat-identity', 'backward-compat-secret-do-not-reuse');
  const node = cleaker(me as any, 'localhost');
  const idProof = await node.prove({ rootNamespace: 'localhost', challenge: null });
  const identityHash = idProof.identityHash;
  const publicKey = idProof.publicKey;

  const claims = readClaims();
  claims.pubkeys = { [identityHash]: publicKey };
  claims.usernames = { [identityHash]: 'backward-compat-identity' };
  claims.admins = { [identityHash]: true };
  claims.grants = { [identityHash]: ['gateway:control:logs-read'] };
  writeClaims(claims);

  console.log(`\n[1] a NEW-format proof (challenge includes "query") against the REAL OLD me_sig.lua (${OLD_VERIFIER_COMMIT})`);
  {
    const method = 'GET';
    const p = '/logs?type=access';
    const [pathOnly, actualQuery = ''] = p.split('?');
    const nonce = genNonce();
    const timestamp = Date.now();
    const bodyHash = sha256Hex('');
    const query = canonicalizeQuery(actualQuery); // the NEW field -- the only thing under test
    const challenge = canonicalJson({ method, path: pathOnly, query, bodyHash, nonce, timestamp });

    const proof = await node.prove({ rootNamespace: 'localhost', challenge });
    const proofB64 = Buffer.from(JSON.stringify(proof)).toString('base64url');

    const res: { status: number; text: string } = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: p, timeout: 8000, headers: { host: 'localhost', connection: 'close', 'x-me-proof': proofB64 } }, (r) => {
        let text = ''; r.setEncoding('utf8'); r.on('data', (c) => { text += c; });
        r.on('end', () => resolve({ status: r.statusCode || 0, text }));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
      req.end();
    });
    let json: any = {}; try { json = JSON.parse(res.text); } catch { /* not json */ }
    check(
      'OLD verifier accepts the NEW-format proof -> 200, real log content (not rejected for an unrecognized "query" field)',
      res.status === 200 && Array.isArray(json.logs) && json.logs.some((l: string) => l.includes('sensitive-looking-path')),
      JSON.stringify(json),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('backward-compat probe complete');
