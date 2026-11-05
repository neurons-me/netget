import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// What leaves on an anonymous GET /apps. Found live 2026-11-05: cleaker.me/apps (the gateway's routes mounted in the
// monad, reached through `location /`) answered every registry entry in full -- loopback port and URL, pid, working
// directory, exposure policy -- while netget.site/apps (apps.lua, local-only) answered 403. Now the route itself
// answers an allow-listed view (gateway/appsProjection.mjs) to anyone without an admin session, whatever door or
// header the request carries.
//
// Disposable everything: temp data dir, temp monad on port 0 with the gateway module. Requests only to that port.

// ── 1. the projection ───────────────────────────────────────────────────────
const { publicAppView, PUBLIC_APP_FIELDS } = await import('../src/gateway/appsProjection.mjs');
assert.deepEqual([...PUBLIC_APP_FIELDS], ['name', 'kind', 'trust', 'status', 'lastSeenMs', 'ttlMs']);

const now = Date.now();
const entry = {
  name: 'monad:netget', kind: 'monad', trust: 'peer', status: 'running', lastSeenMs: now, ttlMs: 12000,
  id: 'monad:f3d6cbc8', port: 8161, host: '127.0.0.1', url: 'http://127.0.0.1:8161', pid: 841042,
  cwd: '/mnt/neuroverse/releases/r20261019-1/modules/monad/Typescript',
  metadata: { endpoint: 'http://127.0.0.1:8161', claimedNamespaces: ['cleaker.me'], identityHash: 'ab'.repeat(32) },
  exposure: { visibility: 'loopback', auth: { rolesAllowed: ['admin'] } },
  tags: ['local', 'monad'], localOnly: true, someFutureField: 'internal',
};
const view = publicAppView(entry);
assert.deepEqual(view, { name: 'monad:netget', kind: 'monad', trust: 'peer', status: 'running', lastSeenMs: now, ttlMs: 12000 });
for (const leaked of ['id', 'port', 'host', 'url', 'pid', 'cwd', 'metadata', 'exposure', 'tags', 'localOnly', 'someFutureField']) {
  assert.equal(leaked in view, false, `${leaked} does not leave`);
}
// garbage in, nothing out
assert.deepEqual(publicAppView(null as any), {});
assert.deepEqual(publicAppView('x' as any), {});

// ── 2. the route, on a real monad with the gateway module ───────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-apps-projection-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
  updatedAt: new Date(now).toISOString(),
  apps: {
    'monad:netget': entry,
    // stale: past its ttl, never listed (unchanged behavior)
    'monad:gone': { ...entry, name: 'monad:gone', lastSeenMs: now - 60_000 },
  },
}));
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'apps-projection.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');

const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot,
  seed: 'apps-projection-test-seed',
  namespace: 'apps-projection.me',
  stateDir: path.join(monadRoot, 'me-state'),
  claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'apps-projection.me', selfHostname: 'apps-projection.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'],
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

const getApps = async (headers: Record<string, string> = {}) => {
  const r = await fetch(`${origin}/apps`, { headers: { accept: 'application/json', ...headers } });
  return { status: r.status, body: await r.json() };
};

try {
  // Every way an anonymous caller can dress the request: nothing, what nginx adds for a public visitor (cleaker.me's
  // `location /`), a forged "local" X-Real-IP, the old perimeter's identity headers, an invalid bearer.
  const variants: Array<[string, Record<string, string>]> = [
    ['nothing', {}],
    ['public visitor via nginx', { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-host': 'cleaker.me', host: 'cleaker.me' }],
    ['forged loopback X-Real-IP', { 'x-real-ip': '127.0.0.1', 'x-forwarded-for': '127.0.0.1' }],
    ['forged identity headers', { 'x-netget-identity': 'a'.repeat(64), 'x-netget-scopes': JSON.stringify(['gateway:read', 'gateway:write']) }],
    ['invalid bearer', { authorization: 'Bearer not-a-session' }],
  ];
  for (const [label, headers] of variants) {
    const { status, body } = await getApps(headers);
    assert.equal(status, 200, `${label}: still a public route`);
    assert.equal(body.count, 1, `${label}: the stale entry is not listed`);
    assert.deepEqual(body.apps, [view], `${label}: only the allow-listed fields`);
    const text = JSON.stringify(body);
    for (const leaked of ['8161', '841042', '/mnt/neuroverse', 'claimedNamespaces', 'rolesAllowed', 'localOnly']) {
      assert.equal(text.includes(leaked), false, `${label}: "${leaked}" does not leave`);
    }
  }
  // what the monad page and the dashboard need is still there: names, kind and liveness
  const { body } = await getApps();
  assert.equal(body.apps[0].name, 'monad:netget');
  assert.equal(body.apps[0].kind, 'monad');
  assert.ok(now - body.apps[0].lastSeenMs <= body.apps[0].ttlMs);
  console.log('apps-public-projection: ok');
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
