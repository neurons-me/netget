import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { internalHeaders } from '../src/gateway/internalToken.ts';

// The domain registry lives in the namespace tree (domainStore.ts), but the monad
// reserves domainIndex and domains.* for the machine's own callers (internal token).
// An anonymous NRP reader must see disclosure "closed" and no record values.
// With the internal token, NRP must match getDomains() after every change.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-domain-read-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(home, '.get', 'runtime'), { recursive: true });
process.env.HOME = home;
process.env.MONADS_HOME = path.join(home, '.monad', 'monads');
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'read-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;

const ROOT = 'read-test.me';
const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'domain-read-contract-seed', namespace: ROOT,
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'), selfIdentity: ROOT, selfHostname: ROOT,
  selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot,
  reactUmdDir: monadRoot, reactDomUmdDir: monadRoot, routesPath: path.join(monadRoot, 'routes.js'),
  modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const server: import('node:http').Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.NETGET_MONAD_ORIGIN = origin;

const { registerDomain, getDomains, updateDomainTarget, deleteDomain } = await import('../src/kernel/domainStore.ts');

const unescape = (k: string) => k.replace(/__DOT__/g, '.');
async function nrpRead(namespace: string, p: string, headers: Record<string, string> = {}): Promise<{ value: any; disclosure?: string } | undefined> {
  const res = await fetch(`${origin}/${p}`, { headers: { host: namespace, 'x-forwarded-host': namespace, accept: 'application/json', ...headers } });
  if (res.status === 404) return undefined;
  assert.equal(res.status, 200, `${namespace}/${p} answered ${res.status}`);
  const body: any = await res.json();
  return { value: body.target?.value, disclosure: body.disclosure };
}

const FIELDS = ['domain', 'target', 'type', 'email', 'sslMode', 'projectPath', 'owner'] as const;
function normalize(rows: any[]) {
  return rows
    .map((r) => Object.fromEntries(FIELDS.filter((f) => r[f] !== undefined).map((f) => [f, r[f]])))
    .sort((a, b) => String(a.domain).localeCompare(String(b.domain)));
}

function leaksRegistry(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  const obj = value as Record<string, any>;
  if (Object.keys(obj).length === 0) return false;
  return Object.values(obj).some((entry) => entry && typeof entry === 'object' && ('owner' in entry || 'target' in entry || 'type' in entry));
}

async function assertAnonymousClosed(label: string) {
  const index = await nrpRead(`netget.${ROOT}`, 'domainIndex');
  assert.ok(index, `${label}: anonymous read of domainIndex must be answered (closed), not missing`);
  assert.equal(index.disclosure, 'closed', `${label}: anonymous NRP must see domainIndex as closed`);
  assert.equal(leaksRegistry(index.value), false, `${label}: anonymous NRP must not receive registry records`);
}

async function listViaNrp() {
  const index = await nrpRead(`netget.${ROOT}`, 'domainIndex', internalHeaders());
  if (!index) return { rows: [], disclosure: undefined };
  assert.equal(index.disclosure, 'public', 'with the internal token, the index is a public NRP value');
  const rows: any[] = [];
  for (const [escaped, entry] of Object.entries<any>(index.value ?? {})) {
    const owner = entry?.owner || 'netget';
    const record = await nrpRead(`${owner}.${ROOT}`, `domains.${escaped}`, internalHeaders());
    if (record?.value && typeof record.value === 'object') rows.push({ domain: unescape(escaped), ...record.value });
  }
  return { rows, disclosure: index.disclosure };
}

async function assertAgree(label: string) {
  await assertAnonymousClosed(label);
  const viaStore = normalize(await getDomains());
  const viaNrp = normalize((await listViaNrp()).rows);
  assert.deepEqual(viaNrp, viaStore, `${label}: internal NRP read and getDomains() disagree`);
  return viaStore;
}


const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const portApp = await freePort();
const portTwo = await freePort();
const portUpdated = await freePort();

try {
  assert.deepEqual(await assertAgree('empty registry'), []);

  const staticDir = path.join(tmp, 'static-three');
  fs.mkdirSync(staticDir, { recursive: true });
  await registerDomain('app.example.com', undefined, 'ops@example.com', 'letsencrypt', undefined, undefined, `127.0.0.1:${portApp}`, 'proxy', '/srv/app', 'alice');
  await registerDomain('two.example.com', undefined, undefined, undefined, undefined, undefined, `127.0.0.1:${portTwo}`, 'proxy', undefined, undefined);
  await registerDomain('three.example.com', undefined, undefined, undefined, undefined, undefined, staticDir, 'static', undefined, 'alice');
  const afterRegister = await assertAgree('after register');
  assert.deepEqual(afterRegister.map((d) => [d.domain, d.owner]), [['app.example.com', 'alice'], ['three.example.com', 'alice'], ['two.example.com', 'netget']]);

  await updateDomainTarget('two.example.com', `127.0.0.1:${portUpdated}`);
  const afterUpdate = await assertAgree('after update');
  assert.equal(afterUpdate.find((d) => d.domain === 'two.example.com')!.target, `127.0.0.1:${portUpdated}`);

  await deleteDomain('two.example.com');
  const afterDelete = await assertAgree('after delete');
  assert.deepEqual(afterDelete.map((d) => d.domain), ['app.example.com', 'three.example.com']);
  assert.equal(Object.keys((await nrpRead(`netget.${ROOT}`, 'domainIndex', internalHeaders()))!.value).length, 2, 'the deleted domain is gone from the index');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('domain-tree-read-contract.test.ts: all assertions passed');
