import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Who may use the gateway's routes when they are the monad's routes (src/gateway/adminGate.mjs).
// The gateway's Express routes assumed a perimeter (nginx verifying signatures in Lua, "loopback"
// meaning the operator). Behind a reverse proxy every request arrives from 127.0.0.1 and any header
// can be sent by anyone, so routes that change the gateway -- add or repoint a domain, stop
// OpenResty, register an app, and /__gateway/claim, which makes the caller OWNER of a gateway that
// has none -- were open to anyone who could reach the monad.
//
// Disposable everything: temp data dir, temp monad on port 0, and a stand-in `netget` on PATH that
// records whether anyone ran it -- so a refusal that regressed would not stop this machine's
// OpenResty. Requests only to that 127.0.0.1 port.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-anon-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
const stubDir = path.join(tmp, 'bin');
fs.mkdirSync(stubDir);
const ranLog = path.join(tmp, 'netget-ran.log');
fs.writeFileSync(path.join(stubDir, 'netget'), `#!/bin/sh\necho "$@" >> "${ranLog}"\necho '{"ok":true,"stub":true}'\n`, { mode: 0o755 });
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'anon-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;
const ran = () => (fs.existsSync(ranLog) ? fs.readFileSync(ranLog, 'utf8').trim().split('\n').filter(Boolean) : []);

const here = path.dirname(fileURLToPath(import.meta.url));
// express is the routes' own dependency (src/htmls/Netget-REACT/backend), not the package's
const express: any = createRequire(path.join(here, '../src/htmls/Netget-REACT/backend/routes/localNetget.js'))('express');
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const { classifyRoute, gatewayAdminGate, WRITE_SCOPE } = await import('../src/gateway/adminGate.mjs');

// ── 1. the policy ───────────────────────────────────────────────────────────
assert.equal(classifyRoute('GET', '/domains'), 'public');
assert.equal(classifyRoute('GET', '/main-server-namespace'), 'public');
assert.equal(classifyRoute('POST', '/setup/claim'), 'own');
assert.equal(classifyRoute('POST', '/admin-session/verify'), 'own');
assert.equal(classifyRoute('GET', '/logs'), 'own');
for (const [m, p] of [['POST', '/add-domain'], ['POST', '/openresty-stop'], ['POST', '/__gateway/claim'], ['POST', '/apps/report'], ['POST', '/domains/metadata'], ['GET', '/some-route-added-later'], ['POST', '/domains']]) {
  assert.equal(classifyRoute(m, p), 'trusted', `${m} ${p} is trusted unless listed as public`);
}

// ── 2. the gate on a tiny app: sessions, owners, forged headers ─────────────
{
  const router = express.Router();
  const seen: any[] = [];
  router.get('/open', (req, res) => { seen.push({ id: req.headers['x-netget-identity'], sc: req.headers['x-netget-scopes'] }); res.json({ ok: true }); });
  router.get('/domains', (req, res) => { seen.push({ id: req.headers['x-netget-identity'], sc: req.headers['x-netget-scopes'] }); res.json({ ok: true }); });
  router.post('/add-domain', (req, res) => { seen.push({ id: req.headers['x-netget-identity'], sc: req.headers['x-netget-scopes'] }); res.json({ ok: true }); });
  const sessions: Record<string, { identityHash: string; scopes: string[] }> = {
    writer: { identityHash: 'id-writer', scopes: [WRITE_SCOPE] },
    reader: { identityHash: 'id-reader', scopes: ['gateway:read'] },
    owner: { identityHash: 'id-owner', scopes: [] },
  };
  const app = express();
  app.use(gatewayAdminGate([router], {
    resolveSession: async (t: string) => sessions[t] ?? null,
    isOwner: (id: string) => id === 'id-owner',
  }));
  app.use(router);
  app.get('/tree/route', (_req, res) => res.json({ tree: true }));
  const srv: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const call = (method: string, p: string, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { method, headers });
  const forged = { 'x-netget-identity': 'attacker', 'x-netget-scopes': JSON.stringify([WRITE_SCOPE]) };
  try {
    // forged identity headers are not a credential
    seen.length = 0;
    let r = await call('POST', '/add-domain', forged);
    assert.equal(r.status, 401); assert.equal((await r.json()).error, 'ADMIN_SESSION_REQUIRED');
    assert.deepEqual(seen, [], 'the route never ran');
    // ...and are dropped on the routes that are open, so a route that reads them sees nothing
    r = await call('GET', '/domains', forged);
    assert.equal(r.status, 200); assert.deepEqual(seen.pop(), { id: undefined, sc: undefined });
    // an unknown or bad token is no session
    assert.equal((await call('POST', '/add-domain', { authorization: 'Bearer nobody' })).status, 401);
    assert.equal((await call('POST', '/add-domain', { authorization: 'Basic writer' })).status, 401);
    // a session without the write capability is refused, with the capability named
    r = await call('POST', '/add-domain', { authorization: 'Bearer reader' });
    assert.equal(r.status, 403); assert.equal((await r.json()).required, WRITE_SCOPE);
    // a session with it passes, and the route sees the SESSION's identity, not the forged one
    seen.length = 0;
    r = await call('POST', '/add-domain', { authorization: 'Bearer writer', ...forged });
    assert.equal(r.status, 200);
    assert.deepEqual(seen.pop(), { id: 'id-writer', sc: JSON.stringify([WRITE_SCOPE]) });
    // the owner needs no explicit scope
    r = await call('POST', '/add-domain', { authorization: 'Bearer owner' });
    assert.equal(r.status, 200);
    // paths that are not gateway routes are not the gate's business
    assert.equal((await call('GET', '/tree/route')).status, 200);
  } finally { srv.close(); }
}

// ── 3. end to end on a real monad with the gateway module ───────────────────
const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot,
  seed: 'anonymous-access-test-seed',
  namespace: 'anon-test.me',
  stateDir: path.join(monadRoot, 'me-state'),
  claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'anon-test.me', selfHostname: 'anon-test.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'],
  port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'),
  modules: [modulePath],
  logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const server: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.NETGET_MONAD_ORIGIN = origin;
const token = process.env.MONAD_INTERNAL_TOKEN!;
assert.match(token, /^[0-9a-f]{64}$/);

const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${origin}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const forgedHeaders = { 'x-netget-identity': 'a'.repeat(64), 'x-netget-scopes': JSON.stringify([WRITE_SCOPE]) };

try {
  const claimBody = { identityHash: 'a'.repeat(64), publicKey: 'A'.repeat(43), username: 'attacker' };
  const mutating: Array<[string, string, unknown]> = [
    ['POST', '/__gateway/claim', claimBody],
    ['POST', '/add-domain', { domain: 'evil.test', type: 'proxy', target: 'http://10.0.0.1:80' }],
    ['POST', '/update-domain', { domain: 'anything.test', updatedFields: { target: 'http://10.0.0.1:80' } }],
    ['POST', '/delete-domain', { domain: 'anything.test' }],
    ['POST', '/provision-cert', { domain: 'evil.test' }],
    ['POST', '/domains/metadata', { domain: 'evil.test' }],
    ['POST', '/apps/report', { name: 'evil', host: '10.0.0.1', port: 80 }],
    ['POST', '/openresty-restart', {}],
    ['POST', '/openresty-stop', {}],
    ['POST', '/frontend-mode', { mode: 'dev' }],
    ['POST', '/apps/x/frontend-mode', { mode: 'dev' }],
    ['POST', '/openresty/install', {}],
    ['GET', '/openresty/install/progress', undefined],
  ];
  for (const [method, p, body] of mutating) {
    for (const headers of [{}, forgedHeaders, { authorization: 'Bearer not-a-session' }]) {
      const r = await send(method, p, body, headers);
      assert.equal(r.status, 401, `${method} ${p} with ${Object.keys(headers).join('+') || 'nothing'} answered ${r.status}`);
    }
  }
  assert.deepEqual(ran(), [], 'nothing ran the netget CLI for an anonymous caller');
  // the attacker did not become the gateway's owner
  const identity = await (await send('GET', '/gateway-identity')).json();
  assert.ok(!identity.owner && !identity.claimed, `gateway stayed unclaimed: ${JSON.stringify(identity)}`);
  // and nothing was registered
  assert.deepEqual((await (await send('GET', '/domains')).json()).domains, []);

  // the routing records cannot be written around the routes either (POST / on the monad)
  for (const expression of ['domains.evil__DOT__test.target', 'domainIndex.evil__DOT__test']) {
    const r = await send('POST', '/', { operation: 'write', expression, value: expression.startsWith('domainIndex') ? { owner: 'netget' } : 'http://10.0.0.1:80' },
      { host: 'netget.anon-test.me', 'x-forwarded-host': 'netget.anon-test.me' });
    assert.equal(r.status, 403, expression);
  }
  assert.deepEqual((await (await send('GET', '/domains')).json()).domains, []);

  // what visitors are meant to see stays public
  for (const p of ['/gateway-identity', '/main-server-namespace', '/domains', '/healthcheck']) {
    assert.equal((await send('GET', p)).status, 200, p);
  }
  // routes that authenticate themselves are reached (their own answer, not the gate's)
  const setup = await send('POST', '/setup/verify-code', { code: 'nope' });
  assert.notEqual((await setup.json().catch(() => ({}))).error, 'ADMIN_SESSION_REQUIRED');
  assert.notEqual((await send('POST', '/admin-session/challenge', {})).status, 404);

  // the machine's own callers still work: the operator's CLI, the bootstrap script
  const internal = { 'x-monad-internal-token': token };
  assert.equal((await send('POST', '/add-domain', { domain: 'ok.test', type: 'proxy', owner: 'netget' }, internal)).status, 200);
  assert.deepEqual((await (await send('GET', '/domains')).json()).domains.map((d: any) => d.domain), ['ok.test']);
  assert.equal((await send('POST', '/add-domain', { domain: 'bad.test', type: 'proxy' }, { 'x-monad-internal-token': token.replace(/.$/, 'x') })).status, 401);
  assert.equal((await send('POST', '/openresty-restart', {}, internal)).status, 200);
  assert.deepEqual(ran(), ['reload --json'], 'the stand-in ran exactly once, for the internal caller');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-anonymous-access.test.ts: all assertions passed');
process.exit(0);
