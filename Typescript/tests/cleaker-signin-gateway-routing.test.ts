// cleaker-signin-gateway-routing.test.ts — permanent regression test for the
// "/claims/signIn gives a 405 behind the admin-block gateway" investigation
// (2026-10-05). Settles, with the REAL client code (not a raw HTTP probe),
// which transport origins a genuine signed login actually completes through.
//
// Background: a raw `POST /claims/signIn` against the admin block
// (local.netget/local.host/local.cleaker — a pure static-SPA server block,
// no monad proxy in its `location /`) 405s, because that block has no route
// for it at all. That looked, at first, like a missing `/claims` proxy route
// worth adding. It is not: cleaker's real claim() (binder.ts's
// claimRemote()) never calls `/claims` — it calls `POST
// /me/kernel:claim/<namespace>`, a generic NRP semantic path. Adding one
// named route (`/claims`) would still 405 on that call, and on the next
// semantic path some future feature needs, and the one after that — a
// whitelist of individual locations can never keep up with an open set of
// NRP paths. Confirmed empirically below: a real signed claim()+signIn()
// through the bare admin-block root fails at the FIRST call (claim), while
// the exact same signed login succeeds completely through either of the
// two routes that already proxy generically today:
//   - the existing /apps/<name> mesh-proxy prefix (monad_proxy.lua) — any
//     path under it reaches the named monad, whatever that path is.
//   - the bare machine-hostname server block (surface_proxy.lua) — proxies
//     every path for a monad whose claimed namespace matches the request's
//     rootspace, no path ever rewritten.
// The real fix for "transportOrigin reached a 405" is therefore never a new
// gateway route — it's making sure whatever builds a transportOrigin for the
// admin-block hostnames uses one of the two existing generic prefixes (or,
// per this session's architecture discussion, retargets local clients at the
// machine's real hostname instead of the local.cleaker/local.netget/
// local.host aliases, which are a static admin SPA, not a monad surface).
//
// cleaker/this.me are imported by RELATIVE PATH to their real dist builds,
// not as bare 'cleaker'/'this.me' specifiers — netget's own package.json
// pins published versions of both (^3.2.1 / ^3.9.1) for its own runtime
// use, which would silently test a different binder.ts than the one this
// monorepo's GUI/monad actually ship. Same workaround monad/Typescript's own
// signUpClaimFlow.test.ts already uses for the identical reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { meDistUrl } from './_meDist.ts';
import { execFileSync, spawn } from 'node:child_process';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) {
  console.log('skipped: no openresty on this machine');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-cleaker-signin-routing-'));
const home = path.join(tmp, 'home');
const dataDir = path.join(tmp, 'data');
const prefix = path.join(tmp, 'or');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'html'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'html', 'index.html'), '<!doctype html><title>panel</title>');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
process.env.HOME = home;
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'local.cleaker';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;
delete process.env.JWT_SECRET;

// Scoped to this test process only — the disposable gateway below uses a
// self-signed cert, and real client code (fetch) validates TLS by default.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const machineHostname = (() => {
  const h = os.hostname();
  return h.endsWith('.local') ? h : `${h}.local`;
})().toLowerCase();

const certDir = path.join(tmp, 'cert');
fs.mkdirSync(certDir);
const keyFile = path.join(certDir, 'k.pem');
const crtFile = path.join(certDir, 'c.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', '2', '-subj', '/CN=localhost',
  '-addext', `subjectAltName=DNS:localhost,DNS:local.cleaker,DNS:${machineHostname},IP:127.0.0.1`,
], { stdio: 'ignore' });
fs.mkdirSync(path.join(home, '.netget', 'certs'), { recursive: true });
fs.copyFileSync(crtFile, path.join(home, '.netget', 'certs', 'local.netget.pem'));
fs.copyFileSync(keyFile, path.join(home, '.netget', 'certs', 'local.netget-key.pem'));

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});
const HTTP_PORT = await freePort();
const HTTPS_PORT = await freePort();

const netgetTsRoot = path.resolve(import.meta.dirname, '..');
const modulePath = path.resolve(netgetTsRoot, 'src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app = await createMonadApp({
  cwd: monadRoot, seed: 'cleaker-signin-routing-seed', namespace: 'local.cleaker',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'local.cleaker', selfHostname: 'local.cleaker', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const monad = await new Promise<import('node:http').Server>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const monadPort = (monad.address() as net.AddressInfo).port;
const monadOrigin = `http://127.0.0.1:${monadPort}`;
process.env.NETGET_MONAD_ORIGIN = monadOrigin;
process.env.NETGET_GATEWAY_UPSTREAM = monadOrigin;

// Registered under two different names/namespaces in apps.json -- one for
// the name-based /apps/:name mesh proxy (monad_proxy.lua resolves by name,
// reads app.host/app.port), one for the bare-hostname block (surface_proxy.lua
// resolves by rootspace-of(Host) == metadata.namespace, reads
// metadata.endpoint/directEndpoint/controlEndpoint -- a different candidate
// shape, confirmed by reading both handlers).
fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
  apps: {
    'monad:netget': {
      id: 'monad:netget', name: 'monad:netget', kind: 'monad',
      host: '127.0.0.1', port: monadPort, protocol: 'http',
      trust: 'owner', lastSeenMs: Date.now(), ttlMs: 600000,
      exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } },
      metadata: { monadName: 'netget', namespace: 'local.cleaker' },
    },
    'monad:hostname-surface': {
      id: 'monad:hostname-surface', name: 'monad:hostname-surface', kind: 'monad',
      host: '127.0.0.1', port: monadPort, protocol: 'http',
      trust: 'owner', lastSeenMs: Date.now(), ttlMs: 600000,
      exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } },
      metadata: { monadName: 'hostname-surface', namespace: machineHostname, endpoint: monadOrigin },
    },
  },
}));

const { buildNginxConfigContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigFile.ts'));
const { getNetgetAppConfContent } = await import(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts'));
const layout = {
  layoutKey: 'linux-source', configDir: path.join(prefix, 'conf'), confDDir: path.join(prefix, 'conf.d'), logDir: path.join(prefix, 'logs'),
  configFilePath: path.join(prefix, 'conf', 'nginx.conf'), luaDir: path.join(prefix, 'lua'),
  luaPackagePath: `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;/opt/homebrew/opt/openresty/site/lualib/?.lua;/opt/homebrew/opt/openresty/site/lualib/?/init.lua;;`,
  userDirective: '', isSupported: true,
};
const highPorts = (conf: string) => conf
  .replace(/^\s*listen \[::\]:\d+.*;\n/gm, '')
  .replace(/listen 80( default_server)?;/g, `listen ${HTTP_PORT}$1;`)
  .replace(/listen 443 ssl( default_server)?;/g, `listen ${HTTPS_PORT} ssl$1;`);
fs.writeFileSync(
  path.join(prefix, 'conf', 'nginx.conf'),
  highPorts(buildNginxConfigContent(layout as any)).replace(/^events \{/m, `pid ${path.join(prefix, 'logs', 'nginx.pid')};\nevents {`),
);
fs.writeFileSync(path.join(prefix, 'conf.d', 'netget_app.conf'), highPorts(getNetgetAppConfContent(layout as any)));
fs.copyFileSync('/opt/homebrew/etc/openresty/mime.types', path.join(prefix, 'conf', 'mime.types'));
fs.cpSync(path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/lua'), path.join(prefix, 'lua'), { recursive: true });

let nginx: ReturnType<typeof spawn> | null = null;
const stopNginx = () => {
  try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { /* best effort */ }
  nginx?.kill();
};
const startNginx = async () => {
  const full = { ...process.env, NETGET_DATA_DIR: dataDir };
  const t = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full });
  let out = '';
  t.stderr.on('data', (d) => { out += d; });
  t.stdout.on('data', (d) => { out += d; });
  assert.equal(await new Promise((r) => t.on('close', r)), 0, `openresty -t failed:\n${out}`);
  nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { env: full, stdio: 'ignore' });
  const listening = (port: number) => new Promise<boolean>((r) => {
    const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); });
    c.on('error', () => r(false));
  });
  for (let i = 0; i < 50; i += 1) {
    if (await listening(HTTP_PORT)) { await new Promise((r) => setTimeout(r, 200)); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nginx did not start');
};

// The REAL client code: this.me's ME constructor + cleaker's bindKernel(),
// the exact two calls packages/GUI/Typescript/src/core/session/
// createCleakerSession.ts makes on sign-in/claim (that file's own thin
// session-state wrapper never touches signing or the wire protocol).
function findWorkspaceFile(relatives: string[][]): string {
  let dir = netgetTsRoot;
  for (let i = 0; i < 8; i++) {
    for (const rel of relatives) {
      const candidate = path.join(dir, ...rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('cleaker.es.js not found above ' + netgetTsRoot);
}

const ME = (await import(meDistUrl())).default;
const cleakerUrl = pathToFileURL(findWorkspaceFile([
  ['cleaker', 'Typescript', 'dist', 'cleaker.es.js'],
  ['modules', 'cleaker', 'Typescript', 'dist', 'cleaker.es.js'],
  ['all.this', 'modules', 'cleaker', 'Typescript', 'dist', 'cleaker.es.js'],
])).href;
const cleaker = (await import(cleakerUrl)).default;

async function signedLogin(transportOrigin: string) {
  const username = `repro-${Math.random().toString(36).slice(2, 10)}`;
  const rootNamespace = 'local.cleaker';
  const fullNamespace = `${username}.${rootNamespace}`;
  const me = new (ME as any)(username, 'test-password-not-real', { namespace: rootNamespace });
  const node = cleaker(me, { bootstrap: [transportOrigin], live: false });
  const claimResult = await node.claim({ namespace: fullNamespace });
  const signInResult = await node.signIn({ namespace: fullNamespace });
  return { claimResult, signInResult, fullNamespace };
}

try {
  await startNginx();

  // [B] The existing /apps/<name> mesh-proxy prefix -- already in the
  // generator, untouched by this test. A full signed login completes.
  {
    const transportOrigin = `https://localhost:${HTTPS_PORT}/apps/netget`;
    const { claimResult, signInResult, fullNamespace } = await signedLogin(transportOrigin);
    assert.equal(claimResult.namespace, fullNamespace);
    assert.equal(signInResult.namespace, fullNamespace);
    assert.equal(signInResult.identityHash, claimResult.identityHash);
  }

  // [C] The existing bare machine-hostname block (surface_proxy.lua) -- also
  // already in the generator, untouched. A full signed login completes,
  // with NO path prefix of any kind.
  {
    const transportOrigin = `https://${machineHostname}:${HTTPS_PORT}`;
    const { claimResult, signInResult, fullNamespace } = await signedLogin(transportOrigin);
    assert.equal(claimResult.namespace, fullNamespace);
    assert.equal(signInResult.namespace, fullNamespace);
    assert.equal(signInResult.identityHash, claimResult.identityHash);
  }

  // [A] The bare admin-block root (localhost / 127.0.0.1 on current main;
  // local.cleaker was retired from this block). It is a static/admin surface
  // today, so claim()'s first real call (POST /me/kernel:claim/...)
  // 405s before it ever reaches the monad. This assertion is the regression
  // guard for the finding itself: if it ever stops rejecting, something
  // changed (a new generic route, or an accidental proxy_pass in `location
  // /`) that the rest of this investigation's writeup should be revisited
  // against -- this is not a case this test is trying to make pass.
  {
    const transportOrigin = `https://localhost:${HTTPS_PORT}`;
    await assert.rejects(
      () => signedLogin(transportOrigin),
      /REQUEST_FAILED_405|404|405/,
      'expected the bare admin-block root (localhost) to still have no generic monad proxy in location / ' +
      '-- if this changed, the GUI client no longer needs the /apps/<name> prefix or hostname-based ' +
      'origin this test otherwise verifies, and this whole test should be revisited, not just this assertion',
    );
  }

  console.log('cleaker-signin-gateway-routing.test.ts: all assertions passed');
} finally {
  stopNginx();
  await new Promise((resolve) => monad.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
