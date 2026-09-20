import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
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
  reconcileMainServer, readMainServerState, writeMainServerState, findLetsEncryptCertificate, probeMainServer,
} = await import('../src/gateway/mainServerEntry.ts');

// ── 1. the rules ───────────────────────────────────────────────────────────
type Domain = { domain: string; type?: string; sslCertificate?: string; sslCertificateKey?: string };
type Probe = { reachable: 'ok' | 'failing'; reason?: string };
function fake(opts: { declared?: () => Promise<unknown>; initial?: Domain[]; certs?: Record<string, any>; probes?: Record<string, Probe>; state?: any } = {}) {
  const domains: Domain[] = [...(opts.initial ?? [])];
  const calls: string[] = [];
  const clock = { t: Date.parse('2026-09-20T12:00:00Z') };
  const box: { declared: unknown; state: any; writes: number; probes: Record<string, Probe> } = {
    declared: undefined, state: opts.state ?? null, writes: 0, probes: { ...(opts.probes ?? {}) },
  };
  const deps = {
    namespace: 'door-test.me',
    readDeclared: opts.declared ?? (async () => box.declared),
    listDomains: async () => domains.map((d) => ({ ...d })),
    registerDomain: async (r: any) => {
      calls.push(`register:${r.domain}`);
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
    findCertificate: (domain: string) => (opts.certs ?? {})[domain] ?? null,
    probe: async (domain: string) => { calls.push(`probe:${domain}`); return box.probes[domain] ?? { reachable: 'failing', reason: 'dns: not set up' }; },
    readState: () => box.state,
    writeState: (st: any) => { box.state = st; box.writes += 1; },
    now: () => clock.t,
  };
  return { domains, calls, clock, box, deps };
}
const run = (f: ReturnType<typeof fake>, declared: unknown) => { f.box.declared = declared; return reconcileMainServer(f.deps); };
const withoutProbes = (calls: string[]) => calls.filter((c) => !c.startsWith('probe:'));

{ // nothing declared: nothing derived, nothing written twice
  const f = fake();
  const s = await run(f, undefined);
  assert.equal(s.declared.status, 'unset'); assert.equal(s.active, null); assert.deepEqual(s.doors, []);
  assert.deepEqual(f.calls, []);
  await run(f, undefined);
  assert.equal(f.box.writes, 1, 'an unchanged state is not rewritten (Lua reloads on every write)');
}
{ // a first valid name: door registered, normalized, active at once (there was nothing to keep) -- and NOT assumed reachable
  const f = fake({ probes: {} });
  const s = await run(f, ' https://Netget.Site/ ');
  assert.equal(s.declared.status, 'valid'); assert.equal(s.declared.name, 'netget.site');
  assert.equal(s.active, 'netget.site');
  assert.deepEqual(s.doors.map((d) => [d.name, d.tls, d.reachable, d.reason]), [['netget.site', 'missing', 'failing', 'dns: not set up']]);
  assert.deepEqual(f.calls, ['register:netget.site', 'probe:netget.site']);
}
{ // three facts: declared is valid, configured is true, reachable says otherwise
  const f = fake();
  const s = await run(f, 'netget.site');
  assert.equal(s.declared.status, 'valid'); // declared
  assert.equal(f.domains.length, 1);         // configured
  assert.equal(s.doors[0].reachable, 'failing'); // reachable
}
{ // an unreadable declaration leaves the last state exactly as it was
  const f = fake();
  await run(f, 'netget.site');
  const before = JSON.stringify(f.box.state); const writes = f.box.writes; f.calls.length = 0;
  f.deps.readDeclared = async () => { throw new Error('monad unreachable'); };
  await assert.rejects(reconcileMainServer(f.deps), /monad unreachable/);
  assert.equal(JSON.stringify(f.box.state), before); assert.equal(f.box.writes, writes); assert.deepEqual(f.calls, []);
}
{ // an empty, invalid or contested declaration is recorded, and the last valid configuration stays
  const f = fake({ probes: { 'netget.site': { reachable: 'ok' } } });
  const good = await run(f, 'netget.site');
  assert.equal(good.active, 'netget.site');
  f.calls.length = 0;
  for (const bad of [undefined, '', 'not a host', { name: 'x' }, 42]) {
    const s = await run(f, bad);
    assert.notEqual(s.declared.status, 'valid', JSON.stringify(bad));
    assert.equal(s.active, 'netget.site', `the main server is still netget.site after ${JSON.stringify(bad)}`);
    assert.deepEqual(s.doors.map((d) => d.name), ['netget.site']);
  }
  assert.deepEqual(f.calls, [], 'no domain was touched');
  assert.equal(f.domains.length, 1);
  // a name another purpose holds is contested, not taken
  f.domains.push({ domain: 'cleaker.me', type: 'proxy' });
  const conflict = await run(f, 'cleaker.me');
  assert.equal(conflict.declared.status, 'conflict'); assert.match(conflict.declared.reason!, /already registered as "proxy"/);
  assert.equal(conflict.active, 'netget.site');
  assert.deepEqual(f.calls, []);
  assert.equal(f.domains.find((d) => d.domain === 'cleaker.me')!.type, 'proxy');
}
{ // changing the name: the new door works BEFORE the old one goes
  const f = fake({ probes: { 'netget.site': { reachable: 'ok' } } });
  await run(f, 'netget.site');
  f.calls.length = 0;
  // the new name is declared but DNS/TLS are not there yet
  f.box.probes['admin.example.org'] = { reachable: 'failing', reason: 'tls: certificate has expired' };
  let s = await run(f, 'admin.example.org');
  assert.equal(s.declared.status, 'valid');
  assert.equal(s.active, 'netget.site', 'the old main server stays active while the new one does not answer');
  assert.deepEqual(s.doors.map((d) => [d.name, d.reachable]).sort(), [['admin.example.org', 'failing'], ['netget.site', 'ok']]);
  assert.match(s.declared.reason!, /does not yet answer|does not answer yet/);
  assert.deepEqual(withoutProbes(f.calls), ['register:admin.example.org'], 'the new door is added, the old one is not removed');
  assert.deepEqual(f.domains.map((d) => d.domain).sort(), ['admin.example.org', 'netget.site']);
  // it starts to answer (after the retry window): the switch, then the retirement -- in that order
  f.calls.length = 0; f.clock.t += 60_000;
  f.box.probes['admin.example.org'] = { reachable: 'ok' };
  s = await run(f, 'admin.example.org');
  assert.equal(s.active, 'admin.example.org');
  assert.deepEqual(s.doors.map((d) => d.name), ['admin.example.org']);
  assert.deepEqual(withoutProbes(f.calls), ['delete:netget.site']);
  assert.deepEqual(f.domains.map((d) => d.domain), ['admin.example.org']);
}
{ // a new name that answers at once replaces the old one in the same pass, door first
  const f = fake({ probes: { 'a.test': { reachable: 'ok' }, 'b.test': { reachable: 'ok' } } });
  await run(f, 'a.test'); f.calls.length = 0;
  const s = await run(f, 'b.test');
  assert.equal(s.active, 'b.test');
  assert.deepEqual(withoutProbes(f.calls), ['register:b.test', 'delete:a.test']);
}
{ // the probe is not asked on every pass: an answer is reused inside its window and asked again after
  const f = fake({ probes: { 'a.test': { reachable: 'ok' } } });
  await run(f, 'a.test'); f.calls.length = 0;
  f.clock.t += 60_000; await run(f, 'a.test');
  assert.deepEqual(f.calls, [], 'a good answer is reused for minutes');
  f.clock.t += 5 * 60_000; await run(f, 'a.test');
  assert.deepEqual(f.calls, ['probe:a.test']);
  const g = fake({ probes: {} });
  await run(g, 'b.test'); g.calls.length = 0;
  g.clock.t += 5_000; await run(g, 'b.test');
  assert.deepEqual(g.calls, [], 'a failing name is not hammered');
  g.clock.t += 60_000; g.box.probes['b.test'] = { reachable: 'ok' }; const healed = await run(g, 'b.test');
  assert.equal(healed.doors[0].reachable, 'ok'); assert.deepEqual(g.calls, ['probe:b.test']);
}
{ // a certificate that appears later is attached to the existing door
  const cert = { certificate: '/c/fullchain.pem', key: '/c/privkey.pem' };
  const f = fake({ probes: { 'netget.site': { reachable: 'ok' } } });
  assert.equal((await run(f, 'netget.site')).doors[0].tls, 'missing');
  f.deps.findCertificate = () => cert;
  const s = await run(f, 'netget.site');
  assert.equal(s.doors[0].tls, 'present'); assert.ok(f.calls.includes('attach:netget.site'));
  assert.equal(f.domains[0].sslCertificate, cert.certificate);
}
{ // a door someone removed by hand: the declared name is the truth, and it comes back
  const f = fake({ probes: { 'a.test': { reachable: 'ok' }, 'b.test': { reachable: 'ok' } } });
  await run(f, 'a.test');
  f.domains.splice(0, 1);
  f.calls.length = 0;
  const s = await run(f, 'b.test');
  assert.equal(s.active, 'b.test'); assert.deepEqual(f.domains.map((d) => d.domain), ['b.test']);
}
{ // the generated state file is atomic and round-trips
  const file = path.join(tmp, 'state', 'main-server.json');
  const state = { namespace: 'door-test.me', declared: { name: 'netget.site', status: 'valid' as const }, doors: [], active: 'netget.site', derivedAt: 'now' };
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

// ── 1b. the probe asks the name itself, over TLS ─────────────────────────────
{
  const dir = path.join(tmp, 'tls'); fs.mkdirSync(dir);
  const key = path.join(dir, 'k.pem'); const crt = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2',
    '-subj', '/CN=door.test', '-addext', 'subjectAltName=DNS:door.test'], { stdio: 'ignore' });
  let declaredValue: unknown = 'door.test'; let status = 200;
  const tlsServer = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    res.statusCode = status; res.setHeader('content-type', 'application/json');
    assert.equal(req.url, '/netget.main.server.name'); assert.equal(req.headers.host, 'door.test');
    res.end(JSON.stringify({ target: { value: declaredValue } }));
  });
  await new Promise<void>((r) => tlsServer.listen(0, '127.0.0.1', () => r()));
  const port = (tlsServer.address() as any).port;
  try {
    const trusted = { connectHost: '127.0.0.1', port, ca: fs.readFileSync(crt) };
    assert.deepEqual(await probeMainServer('door.test', trusted), { reachable: 'ok' });
    // TLS that a visitor's browser would refuse
    const noTrust = await probeMainServer('door.test', { connectHost: '127.0.0.1', port });
    assert.equal(noTrust.reachable, 'failing'); assert.match(noTrust.reason!, /^tls: /);
    // a certificate for another name
    const wrongName = await probeMainServer('other.test', { connectHost: '127.0.0.1', port, ca: fs.readFileSync(crt) });
    assert.equal(wrongName.reachable, 'failing'); assert.match(wrongName.reason!, /^tls: /);
    // it answers, but as another namespace (routing does not reach this tree)
    declaredValue = 'someone-else.test';
    const other = await probeMainServer('door.test', trusted);
    assert.equal(other.reachable, 'failing'); assert.match(other.reason!, /^routing: /);
    // it answers, but with an error
    status = 404; declaredValue = 'door.test';
    assert.match((await probeMainServer('door.test', trusted)).reason!, /^http: answered 404/);
  } finally { tlsServer.close(); }
  // nothing listening / a name that does not exist
  const closed = await probeMainServer('door.test', { connectHost: '127.0.0.1', port, timeoutMs: 1000 });
  assert.equal(closed.reachable, 'failing'); assert.match(closed.reason!, /^network: ECONNREFUSED/);
  const nx = await probeMainServer('no-such-name.invalid', { timeoutMs: 3000 });
  assert.equal(nx.reachable, 'failing'); assert.match(nx.reason!, /^(dns|network|timeout): /);
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
  deps.probe = async () => ({ reachable: 'ok' }); // the name does not exist outside this test
  const state = await reconcileMainServer(deps);
  assert.equal(state.declared.status, 'valid'); assert.equal(state.declared.name, 'netget.test');
  assert.equal(state.active, 'netget.test'); assert.equal(state.namespace, 'door-test.me');
  assert.deepEqual(state.doors.map((d) => [d.name, d.reachable]), [['netget.test', 'ok']]);

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
  assert.equal(ns.mainServer.declared.status, 'valid');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-main-server-entry.test.ts: all assertions passed');
process.exit(0);
