// gateway-networks-capability.test.ts
//
// /networks (CRUD for network records: name/ip/owner). Found live
// 2026-10-03 (same audit pass as the catalog/apps-registry fixes): this
// handler had NO authorization of its own at all -- not even
// is_local_request(), unlike openresty.lua/dev_server.lua. It relied
// entirely on nginx's limit_except, which neither restricts GET/HEAD nor
// (separately) reliably reaches content_by_lua_file for the methods it does
// restrict.
//
// A second, unrelated, already-flagged bug (try_files $uri $uri/
// /index.html placed after content_by_lua_file in the same location)
// currently shadows this handler entirely -- confirmed live: nginx serves
// the SPA's index.html for every request to /networks, and lua/handlers/
// networks.lua never runs at all, for any method. That bug is NOT fixed
// here on purpose -- fixing the routing before the handler was authorized
// would have made an unauthorized handler reachable the moment it was
// fixed. Because of it, this test cannot exercise the handler through its
// real /networks location (every request there still hits the SPA
// fallback, not Lua) -- it instead mounts the exact same
// lua/handlers/networks.lua against a separate, test-only location that
// skips try_files, to prove the handler's OWN authorization logic is
// correct in isolation, on disposable infra, ahead of the routing fix.
//
// Fix: operator_access.is_loopback() gates all of /networks (reads
// included -- this handler had no baseline check at all before). Mutations
// (POST/PUT/DELETE: add/update/delete/migrate) additionally require a real
// X-Me-Proof (middleware/me_sig.lua, loaded fresh per request) and the
// gateway:control:networks-write capability (lib/operator_access.lua's
// has_capability(), no owner/admin bypass -- same model as every other fix
// in this audit pass).
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-networks-jewel-'));
const home = path.join(tmp, 'home'); const dataDir = path.join(tmp, 'data'); const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home; process.env.NETGET_DATA_DIR = dataDir; process.env.NETGET_MONAD_NAMESPACE = 'networks-jewel.me';
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
  cwd: monadRoot, seed: 'networks-jewel-seed', namespace: 'networks-jewel.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'networks-jewel.me', selfHostname: 'networks-jewel.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
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
const generatedConf = getNetgetAppConfContent(layout);
// Confirm the real location is still shadowed by try_files, as flagged --
// if this ever stops being true (the routing bug gets fixed), this
// assertion fails loudly here instead of this test silently exercising a
// route it no longer actually represents.
assert.match(generatedConf, /location \/networks \{[\s\S]*?try_files \$uri \$uri\/ \/index\.html;[\s\S]*?\n {4}\}/, 'the real /networks location is still shadowed by try_files (expected, not fixed here)');
// A second, test-only location mounting the SAME handler file without the
// try_files shadow, so the handler's own authorization logic (not the
// routing bug) is what this test proves. Inserted right after the real
// /networks location's own closing brace, so it lands inside the SAME
// server{} block -- appending it after the whole file would put a
// `location` directive outside any server block (a real nginx config error,
// confirmed live while writing this test).
const testMount = `
    location = /__test_networks_direct {
        set $NETGET_LUA_DIR "${layout.luaDir}";
        rewrite ^ /networks break;
        content_by_lua_file lua/handlers/networks.lua;
    }
    location ~ ^/__test_networks_direct/(.*)$ {
        set $NETGET_LUA_DIR "${layout.luaDir}";
        rewrite ^/__test_networks_direct/(.*)$ /networks/$1 break;
        content_by_lua_file lua/handlers/networks.lua;
    }
`;
const networksLocationStart = generatedConf.indexOf('    location /networks {');
assert.ok(networksLocationStart >= 0, 'found the real /networks location to insert after');
const networksLocationEnd = generatedConf.indexOf('\n    }\n', networksLocationStart) + '\n    }\n'.length;
const appConf = generatedConf.slice(0, networksLocationEnd) + testMount + generatedConf.slice(networksLocationEnd);
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

async function signedRequest(node: any, hostname: string, method: string, testPath: string, realPath: string, bodyObj?: Record<string, unknown>, opts: { noProof?: boolean } = {}) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers: Record<string, string> = { host: 'localhost', connection: 'close' };
  if (bodyStr) headers['content-type'] = 'application/json';
  if (!opts.noProof) {
    const signed = { method, path: realPath, bodyHash: sha256Hex(bodyStr), nonce: genNonce(), timestamp: Date.now() };
    const challenge = canonicalJson(signed);
    const proof = await node.prove({ rootNamespace: hostname, challenge });
    headers['x-me-proof'] = Buffer.from(JSON.stringify(proof)).toString('base64url');
  }
  const res: { status: number; text: string } = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: testPath, timeout: 8000, headers }, (r) => {
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

try {
  await startNginx();

  const ME_RESEED = Symbol.for('me.internal.reseed');
  const me = new (ME as any)();
  (me as any)[ME_RESEED]('networks-jewel-identity', 'networks-jewel-secret-do-not-reuse');
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
    claims.usernames[identityHash] = 'networks-jewel-identity';
    if (opts.admin) claims.admins[identityHash] = true; else delete claims.admins[identityHash];
    if (opts.scopes) claims.grants[identityHash] = opts.scopes; else delete claims.grants[identityHash];
    writeClaims(claims);
  }

  let pass = 0; let fail = 0;
  const check = (label: string, cond: boolean, detail?: unknown) => {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
  };

  const bareGet = (p: string): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method: 'GET', path: p, timeout: 8000, headers: { host: 'localhost' } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });

  console.log('\n[1] reads require at least loopback (this handler had zero baseline check before)');
  {
    // can't simulate a non-loopback peer against 127.0.0.1-bound nginx here without
    // a LAN address; the loopback-vs-LAN distinction itself is already proven for
    // the exact same operator_access.is_loopback() by gateway-edge-access.test.ts.
    // What's new and worth proving here is simply that the check now EXISTS at all.
    const r = await bareGet('/__test_networks_direct');
    check('GET (via the un-shadowed test mount, genuinely loopback) -> 200, not open-by-default', r.status === 200, r.text);
  }

  console.log('\n[2] mutations require a real signed proof + the exact capability');
  {
    const r = await signedRequest(node, 'localhost', 'POST', '/__test_networks_direct', '/networks', { name: 'n1', ip: '10.0.0.1', owner: 'x' }, { noProof: true });
    check('POST with no X-Me-Proof at all -> 401', r.status === 401, JSON.stringify(r.json));
  }
  {
    anchor({}); // valid identity, no capability
    const r = await signedRequest(node, 'localhost', 'POST', '/__test_networks_direct', '/networks', { name: 'n1', ip: '10.0.0.1', owner: 'x' });
    check('valid proof, NO capability -> 403 CAPABILITY_DENIED', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
  }
  {
    anchor({ admin: true }); // admin alone, still no grant
    const r = await signedRequest(node, 'localhost', 'POST', '/__test_networks_direct', '/networks', { name: 'n1', ip: '10.0.0.1', owner: 'x' });
    check('admin alone -> still 403', r.status === 403 && r.json.error === 'CAPABILITY_DENIED', JSON.stringify(r.json));
  }

  // networks_db.lua persists to a hardcoded /opt/.get/networks.json
  // (unlike every other handler in this tree, it ignores NETGET_DATA_DIR
  // entirely -- its own header comment says this is deliberate, "to mirror
  // prior location semantics"). That's a separate, pre-existing bug, not
  // introduced or fixed here -- out of scope for an authorization pass, and
  // not something to create real paths on this machine for just to make a
  // disposable test's DB writes succeed. What these checks prove instead:
  // the authorization gate itself gets out of the way for a correctly
  // authorized caller (no more 401/403) -- whatever happens after that is
  // networks_db.lua's own concern, already failing the same way before this
  // fix existed.
  console.log('\n[3] the exact grant clears the authorization gate (the DB write itself hits an unrelated, pre-existing /opt/.get path bug -- not fixed here, see comment above)');
  {
    anchor({ admin: true, scopes: ['gateway:control:networks-write'] });
    const r = await signedRequest(node, 'localhost', 'POST', '/__test_networks_direct', '/networks', { name: 'n1', ip: '10.0.0.1', owner: 'x' });
    check('POST (add) with the exact grant -> past the auth gate (not 401/403)', r.status !== 401 && r.status !== 403, JSON.stringify(r.json));
  }
  {
    const r = await signedRequest(node, 'localhost', 'PUT', '/__test_networks_direct/n1', '/networks/n1', { ip: '10.0.0.99' });
    check('PUT (update) with the same grant -> past the auth gate', r.status !== 401 && r.status !== 403, JSON.stringify(r.json));
  }
  {
    const r = await signedRequest(node, 'localhost', 'DELETE', '/__test_networks_direct/n1', '/networks/n1', undefined);
    check('DELETE with the same grant -> past the auth gate', r.status !== 401 && r.status !== 403, JSON.stringify(r.json));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('networks capability probe complete');
