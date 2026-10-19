import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The operator's panel declares a door's connections through the route it already uses for a door's other fields
// (/update-domain, behind the operator gate): no new location in the router. What is checked, on ONE process (the gateway's
// routes mounted in a disposable monad, temp data dir, loopback only):
//   * `updatedFields: { connections }` declares them, the store's rules answer (reserved prefixes, ports, duplicates), a
//     list with a bad entry is refused AS A WHOLE with 400 CONNECTION_REFUSED and writes nothing;
//   * the door's other fields are untouched by a connections-only update;
//   * /domains returns them to the operator, domain-map.json projects them, and removing them is an update with [];
//   * a door that is not registered is 404, and the route still takes nobody without the internal token or a session.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-door-conn-panel-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'panel-test.me';
delete process.env.NETGET_MONAD_ORIGIN;

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
const monadRoot = path.join(tmp, 'monad');
fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'door-connections-panel-test-seed', namespace: 'panel-test.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'panel-test.me', selfHostname: 'panel-test.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const server: import('node:http').Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = (server.address() as any).port;
process.env.NETGET_MONAD_ORIGIN = `http://127.0.0.1:${port}`;
const origin = process.env.NETGET_MONAD_ORIGIN;
const mapPath = path.join(dataDir, 'runtime', 'domain-map.json');
const readMap = () => JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const authed = { 'content-type': 'application/json', 'x-monad-internal-token': process.env.MONAD_INTERNAL_TOKEN! };
const post = (p: string, body: unknown, headers: Record<string, string> = authed) =>
  fetch(`${origin}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
// what the router holds for a door (projected from the store); /domains gives the full record only to an admin session
const door = async (name: string) => readMap().domains[name];

try {
  const add = await post('/add-domain', { domain: 'fulltrailer.dev.test', type: 'server', target: 'http://127.0.0.1:9900', owner: 'owner' });
  assert.equal(add.status, 200);
  const before = { ...(await door('fulltrailer.dev.test')) };
  assert.equal(before.target, '127.0.0.1:9900');
  assert.deepEqual(before.connections ?? [], []);

  // declare: the API of the app, on its own port
  const declare = await post('/update-domain', { domain: 'fulltrailer.dev.test', updatedFields: { connections: [{ prefix: '/api/fuel', target: '127.0.0.1:9901' }, { prefix: '/uploads', target: '127.0.0.1:9901' }] } });
  assert.equal(declare.status, 200);
  const declared = await declare.json();
  assert.deepEqual(declared.connections.map((c: any) => c.prefix).sort(), ['/api/fuel', '/uploads']);

  // the door's other fields are exactly what they were
  const after = await door('fulltrailer.dev.test');
  assert.equal(after.target, before.target);
  assert.equal(after.type, before.type);
  assert.deepEqual((after.connections ?? []).map((c: any) => `${c.prefix}=${c.target}`).sort(), ['/api/fuel=127.0.0.1:9901', '/uploads=127.0.0.1:9901']);

  // an anonymous reader of /domains learns the name, never the wiring
  const publicRows = (await (await fetch(`${origin}/domains`)).json()).domains;
  const publicRow = publicRows.find((d: any) => d.domain === 'fulltrailer.dev.test');
  assert.ok(publicRow, 'the door is listed');
  assert.equal(publicRow.connections, undefined);
  assert.equal(publicRow.target, undefined);

  // a bad entry refuses the WHOLE list and writes nothing
  const listBefore = JSON.stringify((await door('fulltrailer.dev.test')).connections);
  for (const bad of [
    [{ prefix: '/api/ok', target: '127.0.0.1:9902' }, { prefix: '/api/v1', target: '127.0.0.1:9902' }],      // reserved prefix
    [{ prefix: '/api/ok', target: '127.0.0.1:80' }],                                                          // the gateway's own port
    [{ prefix: '/api/ok', target: '10.0.0.5:9902' }],                                                         // not loopback in this delivery
    [{ prefix: '/a', target: '127.0.0.1:9902' }, { prefix: '/a', target: '127.0.0.1:9903' }],                 // duplicate prefix
  ]) {
    const refused = await post('/update-domain', { domain: 'fulltrailer.dev.test', updatedFields: { connections: bad } });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    const body = await refused.json();
    assert.equal(body.code, 'CONNECTION_REFUSED');
    assert.match(String(body.error), /refused/);
  }
  assert.equal(JSON.stringify((await door('fulltrailer.dev.test')).connections), listBefore, 'a refused list wrote nothing');

  // other fields and connections together
  const both = await post('/update-domain', { domain: 'fulltrailer.dev.test', updatedFields: { target: 'http://127.0.0.1:9900', connections: [{ prefix: '/api/fuel', target: '127.0.0.1:9901' }] } });
  assert.equal(both.status, 200);
  assert.equal((await door('fulltrailer.dev.test')).connections.length, 1);

  // removing them is declaring none
  const clear = await post('/update-domain', { domain: 'fulltrailer.dev.test', updatedFields: { connections: [] } });
  assert.equal(clear.status, 200);
  assert.deepEqual((await door('fulltrailer.dev.test')).connections ?? [], []);

  // a door that is not registered
  const missing = await post('/update-domain', { domain: 'nobody.dev.test', updatedFields: { connections: [] } });
  assert.equal(missing.status, 404);

  // nobody without the internal token or a session
  const anonymous = await post('/update-domain', { domain: 'fulltrailer.dev.test', updatedFields: { connections: [{ prefix: '/x', target: '127.0.0.1:9901' }] } }, { 'content-type': 'application/json' });
  assert.ok([401, 403].includes(anonymous.status), `anonymous status ${anonymous.status}`);
  assert.deepEqual((await door('fulltrailer.dev.test')).connections ?? [], [], 'the anonymous request wrote nothing');

  console.log('door-connections-panel: ok');
} catch (error) {
  console.error('door-connections-panel: FAILED', error);
  process.exitCode = 1;
} finally {
  server.close();
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
