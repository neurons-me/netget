import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The flow a person follows on a fresh gateway to publish a domain, end to end
// on ONE process: the gateway's routes mounted in a monad
// (netget/gateway) -> the domain lands in that monad's kernel (.me) -> the
// routing table OpenResty reads (domain-map.json) is projected from the kernel,
// and follows updates and deletes. No sqlite table, no second process.
//
// Disposable everything: temp data dir, a temp monad on port 0, requests only to
// that 127.0.0.1 port.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-add-domain-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'flow-test.me';
delete process.env.NETGET_MONAD_ORIGIN;

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');

const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot,
  seed: 'add-domain-flow-test-seed',
  namespace: 'flow-test.me',
  stateDir: path.join(monadRoot, 'me-state'),
  claimDir: path.join(monadRoot, 'claims'),
  selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'flow-test.me',
  selfHostname: 'flow-test.me',
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
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));

const server: import('node:http').Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as any).port;
// The routes reach the hosting monad as their own origin (set by the module at mount);
// this test's monad listens on port 0 above, so point them at the real port.
process.env.NETGET_MONAD_ORIGIN = `http://127.0.0.1:${port}`;
const origin = process.env.NETGET_MONAD_ORIGIN;

const mapPath = path.join(dataDir, 'runtime', 'domain-map.json');
const readMap = () => JSON.parse(fs.readFileSync(mapPath, 'utf8'));
// The gateway's mutating routes take the machine's own callers (the internal token the
// monad made at start) or an admin session -- never an anonymous request.
// gateway-anonymous-access.test.ts covers the refusals; this flow is the operator's.
const post = (p: string, body: unknown) =>
  fetch(`${origin}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-monad-internal-token': process.env.MONAD_INTERNAL_TOKEN! }, body: JSON.stringify(body) });
const listDomains = async () => (await (await fetch(`${origin}/domains`)).json()).domains.map((d: any) => d.domain);

try {
  // a fresh gateway has no domains at all
  assert.deepEqual(await listDomains(), []);

  // publish a static site, with its certificate paths
  const add = await post('/add-domain', {
    domain: 'Example.Test',
    type: 'static',
    target: '/srv/www/example',
    sslMode: 'letsencrypt',
    sslCertificate: '/etc/letsencrypt/live/example.test/fullchain.pem',
    sslCertificateKey: '/etc/letsencrypt/live/example.test/privkey.pem',
    owner: 'owner',
  });
  assert.equal(add.status, 200);
  assert.deepEqual(await add.json(), { success: true, domain: 'Example.Test' });

  // it is in the kernel...
  assert.deepEqual(await listDomains(), ['example.test']);

  // ...and the routing table OpenResty reads is projected from it, with the
  // certificate paths its SNI lookup needs
  let map = readMap();
  assert.deepEqual(Object.keys(map.domains), ['example.test']);
  assert.equal(map.domains['example.test'].type, 'static');
  assert.equal(map.domains['example.test'].root, '/srv/www/example');
  assert.equal(map.domains['example.test'].ssl.enabled, true);
  assert.equal(map.domains['example.test'].ssl.cert, '/etc/letsencrypt/live/example.test/fullchain.pem');
  assert.ok(fs.existsSync(path.join(dataDir, 'runtime', 'domain-map.version')), 'version file bumped: Lua hot-reloads');

  // a second one, proxied to an app, without a certificate yet
  assert.equal((await post('/add-domain', { domain: 'app.example.test', type: 'server', target: 'http://127.0.0.1:9000', owner: 'owner' })).status, 200);
  map = readMap();
  assert.deepEqual(Object.keys(map.domains).sort(), ['app.example.test', 'example.test']);
  assert.equal(map.domains['app.example.test'].type, 'server');
  assert.equal(map.domains['app.example.test'].target, 'http://127.0.0.1:9000');
  assert.equal(map.domains['app.example.test'].ssl.enabled, false);

  // the same domain twice is refused
  assert.equal((await post('/add-domain', { domain: 'example.test', type: 'static', target: '/x' })).status, 409);

  // updating follows into the table
  const upd = await post('/update-domain', { domain: 'app.example.test', updatedFields: { target: 'http://127.0.0.1:9100' } });
  assert.equal(upd.status, 200);
  assert.equal(readMap().domains['app.example.test'].target, 'http://127.0.0.1:9100');

  // deleting removes it from the kernel and from the table
  assert.equal((await post('/delete-domain', { domain: 'app.example.test' })).status, 200);
  assert.deepEqual(await listDomains(), ['example.test']);
  assert.deepEqual(Object.keys(readMap().domains), ['example.test']);
  assert.equal((await post('/delete-domain', { domain: 'app.example.test' })).status, 404);

  // nothing in this flow needed (or created) a sqlite domains table
  assert.equal(fs.existsSync(path.join(dataDir, 'domains.db')), false);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-add-domain-flow.test.ts: all assertions passed');
process.exit(0);
