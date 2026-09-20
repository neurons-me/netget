import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The gateway (setup/claim, domains, admin sessions, OpenResty install and
// status) as a package a monad mounts -- src/gateway/monadModule.mjs -- instead
// of its own Express process on :3000 plus a second monad.
//
// Disposable everything: a temp NETGET_DATA_DIR, a temp monad on port 0 with
// its own state, and requests only to that one 127.0.0.1 port. No real
// gateway, no real data dir, no real monad is read or written.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gateway-module-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'gateway-test.me';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const gateway = await import(modulePath);

// ── the pure pieces ─────────────────────────────────────────────────────────

const req = (headers: Record<string, string>, p = '/x') => ({ headers, path: p }) as any;

// A browser call from this host, from a local name, or from a listed host passes;
// any other origin does not; a call without an Origin (not cross-origin) passes.
assert.equal(gateway.isAllowedOrigin(undefined, req({})), true);
assert.equal(gateway.isAllowedOrigin('https://netget.site', req({ host: 'netget.site' })), true);
assert.equal(gateway.isAllowedOrigin('https://netget.site', req({ host: '127.0.0.1:8161', 'x-forwarded-host': 'netget.site' })), true);
assert.equal(gateway.isAllowedOrigin('http://local.cleaker', req({ host: 'local.netget' })), true);
assert.equal(gateway.isAllowedOrigin('http://localhost:5173', req({ host: 'local.netget' })), true);
assert.equal(gateway.isAllowedOrigin('https://cleaker.me', req({ host: 'netget.site' }), ['cleaker.me']), true);
assert.equal(gateway.isAllowedOrigin('https://www.cleaker.me', req({ host: 'netget.site' }), ['cleaker.me']), true);
assert.equal(gateway.isAllowedOrigin('https://evil.example', req({ host: 'netget.site' })), false);
assert.equal(gateway.isAllowedOrigin('https://cleaker.me', req({ host: 'netget.site' })), false, 'not listed, not allowed');
assert.equal(gateway.isAllowedOrigin('not a url', req({ host: 'netget.site' })), false);
assert.equal(gateway.isAllowedOrigin('https://netget.site.evil.example', req({ host: 'netget.site' })), false);

assert.deepEqual(gateway.parseHostList('cleaker.me, https://Other.Me ,,'), ['cleaker.me', 'other.me']);

// The monad answers /explain and /inspect itself: the gateway never takes them.
let delegated = 0;
const handler = (_q: any, _r: any, _n: any) => { delegated += 1; };
const wrapped = gateway.delegateExcept(handler);
let passedOn = 0;
wrapped(req({}, '/explain'), {}, () => { passedOn += 1; });
wrapped(req({}, '/inspect'), {}, () => { passedOn += 1; });
wrapped(req({}, '/setup/verify-code'), {}, () => { passedOn += 1; });
assert.equal(delegated, 1);
assert.equal(passedOn, 2);

// ── against a real monad ────────────────────────────────────────────────────

const { createMonadApp } = await import('monad.ai');

const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot,
  seed: 'gateway-module-test-seed',
  namespace: 'gateway-test.me',
  stateDir: path.join(monadRoot, 'me-state'),
  claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'gateway-test.me',
  selfHostname: 'gateway-test.me',
  selfEndpoint: 'http://127.0.0.1:0',
  selfTags: ['local'],
  port: 0,
  guiPkgDistDir: monadRoot,
  mePkgDistDir: monadRoot,
  cleakerPkgDistDir: monadRoot,
  reactUmdDir: monadRoot,
  reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'),
  modules: [modulePath],
  logger: false,
});

assert.deepEqual(app.monadModules.failed, [], `module failed: ${JSON.stringify(app.monadModules.failed)}`);
assert.deepEqual(app.monadModules.loaded, [modulePath]);

const server: import('node:http').Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const origin = `http://127.0.0.1:${(server.address() as any).port}`;

try {
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // A real gateway route, answered by the real router: no setup code exists in
  // the disposable data dir, so a code is refused (401), as JSON.
  const verify = await post('/setup/verify-code', { code: 'nope' });
  assert.equal(verify.status, 401);
  assert.equal((await verify.json()).ok, false);

  // The routes reach THIS monad as their own origin, and never start another.
  assert.equal(process.env.NETGET_MONAD_ORIGIN, `http://127.0.0.1:${process.env.PORT || (server.address() as any).port}`.replace(/:undefined$/, ''), 'origin');
  const { getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');
  assert.equal(await getNetgetMonadOrigin(), process.env.NETGET_MONAD_ORIGIN);

  // Routes the gateway lists are there...
  const install = await fetch(`${origin}/openresty/install/availability`);
  assert.ok([200, 401, 403].includes(install.status), `install availability answered ${install.status}`);

  // ...a browser call from another origin is refused before any route runs...
  const foreign = await post('/setup/verify-code', { code: 'nope' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, 'ORIGIN_NOT_ALLOWED');

  // ...and the monad keeps answering what it always answered, its own way.
  const nrp = await fetch(`${origin}/`, { headers: { accept: 'application/json' } });
  assert.equal(nrp.status, 200);
  assert.ok((await nrp.json()).target?.nrp?.includes('gateway-test.me'));
  const explain = await post('/explain', { path: 'nothing.here' });
  assert.ok(explain.status < 500, `monad /explain answered ${explain.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-monad-module.test.ts: all assertions passed');
process.exit(0);
