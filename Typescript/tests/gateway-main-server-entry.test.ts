import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The rule that turns "the namespace declares its main server" into "that domain is a
// door into the namespace" (src/gateway/mainServerEntry.ts).
//   1. the rules, against fake dependencies: unset / invalid / conflict / ready,
//      idempotence, certificate attach, retiring the door of a name no longer declared;
//   2. end to end on ONE disposable process: a real monad (namespace declares the name
//      through its starting value) + the gateway module -> the door lands in the kernel,
//      in the routing table nginx reads, and in the generated state file; and
//      /main-server-namespace answers from the tree.
// Disposable everything: temp data dir, temp monad on port 0, temp cert dir.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-main-server-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'door-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0'; // the test drives reconcile itself
delete process.env.NETGET_MONAD_ORIGIN;

const {
  reconcileMainServer, readMainServerState, writeMainServerState, findLetsEncryptCertificate,
} = await import('../src/gateway/mainServerEntry.ts');

// ── 1. the rules ───────────────────────────────────────────────────────────
type Domain = { domain: string; type?: string; sslCertificate?: string; sslCertificateKey?: string };
function fake(declared: unknown, initial: Domain[] = [], certs: Record<string, { certificate: string; key: string }> = {}) {
  const domains: Domain[] = [...initial];
  const written: any[] = [];
  const calls: string[] = [];
  return {
    domains, written, calls,
    deps: {
      namespace: 'door-test.me',
      readDeclared: async () => declared,
      listDomains: async () => domains.map((d) => ({ ...d })),
      registerDomain: async (r: any) => {
        calls.push(`register:${r.domain}:${r.type}:${r.owner}`);
        domains.push({ domain: r.domain, type: r.type, sslCertificate: r.cert?.certificate, sslCertificateKey: r.cert?.key });
      },
      attachCertificate: async (domain: string, cert: any) => {
        calls.push(`attach:${domain}`);
        const d = domains.find((x) => x.domain === domain)!; d.sslCertificate = cert.certificate; d.sslCertificateKey = cert.key;
      },
      deleteDomain: async (domain: string) => {
        calls.push(`delete:${domain}`);
        domains.splice(domains.findIndex((x) => x.domain === domain), 1);
      },
      findCertificate: (domain: string) => certs[domain] ?? null,
      writeState: (s: any) => written.push(s),
    },
  };
}

{ // nothing declared: nothing derived
  const f = fake(undefined);
  const s = await reconcileMainServer(f.deps);
  assert.equal(s.status, 'unset'); assert.equal(s.name, null); assert.deepEqual(f.calls, []);
  assert.equal(f.written.length, 1);
}
{ // not a host
  const f = fake('not a host');
  const s = await reconcileMainServer(f.deps);
  assert.equal(s.status, 'invalid'); assert.deepEqual(f.calls, []);
  assert.equal((await reconcileMainServer(fake({ name: 'x' }).deps)).status, 'invalid');
}
{ // a declared name becomes a door, normalized, without a certificate reported as missing
  const f = fake(' https://Netget.Site/ ');
  const s = await reconcileMainServer(f.deps);
  assert.equal(s.status, 'ready'); assert.equal(s.name, 'netget.site'); assert.equal(s.tls, 'missing');
  assert.equal(s.namespace, 'door-test.me');
  assert.deepEqual(f.calls, ['register:netget.site:main_server:netget']);
  // idempotent: the same declaration again derives nothing new
  f.calls.length = 0;
  assert.equal((await reconcileMainServer(f.deps)).status, 'ready');
  assert.deepEqual(f.calls, []);
}
{ // a certificate already on disk is used at registration, and attached later if it shows up after
  const cert = { certificate: '/c/fullchain.pem', key: '/c/privkey.pem' };
  const withCert = fake('netget.site', [], { 'netget.site': cert });
  const s = await reconcileMainServer(withCert.deps);
  assert.equal(s.tls, 'present'); assert.equal(withCert.domains[0].sslCertificate, cert.certificate);

  const later = fake('netget.site', [{ domain: 'netget.site', type: 'main_server' }], { 'netget.site': cert });
  assert.equal((await reconcileMainServer(later.deps)).tls, 'present');
  assert.deepEqual(later.calls, ['attach:netget.site']);
}
{ // a name another purpose already holds is refused and left alone
  const f = fake('cleaker.me', [{ domain: 'cleaker.me', type: 'proxy' }]);
  const s = await reconcileMainServer(f.deps);
  assert.equal(s.status, 'conflict'); assert.match(s.reason!, /already registered as "proxy"/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.domains.length, 1);
}
{ // declaring another name retires the door derived for the old one; other domains stay
  const f = fake('admin.example.org', [
    { domain: 'netget.site', type: 'main_server' },
    { domain: 'cleaker.me', type: 'proxy' },
  ]);
  const s = await reconcileMainServer(f.deps);
  assert.equal(s.status, 'ready');
  assert.deepEqual(f.calls.sort(), ['delete:netget.site', 'register:admin.example.org:main_server:netget']);
  assert.deepEqual(f.domains.map((d) => d.domain).sort(), ['admin.example.org', 'cleaker.me']);
}
{ // a conflict does not retire anything either
  const f = fake('cleaker.me', [{ domain: 'cleaker.me', type: 'proxy' }, { domain: 'netget.site', type: 'main_server' }]);
  await reconcileMainServer(f.deps);
  assert.deepEqual(f.calls, []);
}
{ // the generated state file is atomic and round-trips
  const file = path.join(tmp, 'state', 'main-server.json');
  const state = { status: 'ready' as const, name: 'netget.site', namespace: 'door-test.me', tls: 'present' as const, derivedAt: 'now' };
  writeMainServerState(state, file);
  assert.deepEqual(readMainServerState(file), state);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  assert.equal(readMainServerState(path.join(tmp, 'nope.json')), null);
}
{ // certificates: only when both files exist
  const live = path.join(tmp, 'live');
  fs.mkdirSync(path.join(live, 'a.test'), { recursive: true });
  fs.writeFileSync(path.join(live, 'a.test', 'fullchain.pem'), 'x');
  assert.equal(findLetsEncryptCertificate('a.test', live), null);
  fs.writeFileSync(path.join(live, 'a.test', 'privkey.pem'), 'x');
  assert.deepEqual(findLetsEncryptCertificate('a.test', live), {
    certificate: path.join(live, 'a.test', 'fullchain.pem'), key: path.join(live, 'a.test', 'privkey.pem'),
  });
}

// ── 2. end to end ──────────────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot,
  seed: 'main-server-entry-test-seed',
  namespace: 'door-test.me',
  stateDir: path.join(monadRoot, 'me-state'),
  claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'door-test.me',
  selfHostname: 'door-test.me',
  selfEndpoint: 'http://127.0.0.1:0',
  selfTags: ['local'],
  port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot,
  reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'),
  modules: [modulePath],
  mainServerName: 'Netget.Test',
  logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const server: import('node:http').Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as any).port;
process.env.NETGET_MONAD_ORIGIN = `http://127.0.0.1:${port}`;
const origin = process.env.NETGET_MONAD_ORIGIN;

try {
  // the namespace declares it, publicly, at the path
  const declared = await (await fetch(`${origin}/netget.main.server.name`, { headers: { host: 'door-test.me', 'x-forwarded-host': 'door-test.me', accept: 'application/json' } })).json();
  assert.equal(declared.target.value, 'netget.test');
  assert.equal(declared.disclosure, 'public');

  // nobody names it over HTTP -- not even from loopback with the right host
  const forged = await fetch(`${origin}/`, {
    method: 'POST', headers: { 'content-type': 'application/json', host: 'door-test.me', 'x-forwarded-host': 'door-test.me' },
    body: JSON.stringify({ operation: 'write', expression: 'netget.main.server.name', value: 'evil.test' }),
  });
  assert.equal(forged.status, 403);

  // before the rule runs there is no door and no generated state
  assert.equal(readMainServerState(), null);

  const { defaultMainServerDeps } = await import('../src/gateway/mainServerEntry.ts');
  const deps = await defaultMainServerDeps();
  const state = await reconcileMainServer(deps);
  assert.equal(state.status, 'ready'); assert.equal(state.name, 'netget.test'); assert.equal(state.namespace, 'door-test.me');

  // the door is in the kernel...
  const domains = (await (await fetch(`${origin}/domains`)).json()).domains;
  const door = domains.find((d: any) => d.domain === 'netget.test');
  assert.ok(door, 'door registered in the kernel');
  assert.equal(door.type, 'main_server');
  // ...in the routing table nginx reads...
  const map = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime', 'domain-map.json'), 'utf8'));
  assert.ok(map.domains['netget.test'], 'door projected into domain-map.json');
  // ...and in the generated state
  assert.deepEqual({ ...readMainServerState()!, derivedAt: '' }, { ...state, derivedAt: '' });

  // running the rule again derives nothing more
  await reconcileMainServer(deps);
  assert.equal((await (await fetch(`${origin}/domains`)).json()).domains.filter((d: any) => d.domain === 'netget.test').length, 1);

  // the route answers from the tree, and says so
  const ns = await (await fetch(`${origin}/main-server-namespace`)).json();
  assert.equal(ns.mainServerName, 'netget.test');
  assert.equal(ns.source, 'namespace');
  assert.equal(ns.mainServer.status, 'ready');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-main-server-entry.test.ts: all assertions passed');
process.exit(0);
