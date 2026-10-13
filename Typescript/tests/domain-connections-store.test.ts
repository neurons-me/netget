import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// A door's connections through the domain store and into domain-map.json (the file surface_proxy.lua and
// monad_proxy.lua read). Same isolation convention as domain-map-ssl-inclusion.test.ts: a disposable monad, never
// the ambient 'netget' one; NETGET_MONAD_NAME is set before any import, and the origin guard is armed first.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `door-conn-test-${process.pid}.local`;
const TEST_MONAD_NAME = `door-conn-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;
fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });

const door = `ft-door-${process.pid}.example`;
const staticDoor = `static-door-${process.pid}.example`;

const { registerDomain, getDomainByName, updateDomainConnections } = await import('../src/kernel/domainStore.ts');
const { generateDomainMap, getDomainMapPath } = await import('../src/runtime/domainMap.ts');
const { startNetgetMonad, getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');
const { readMonadRecord, deleteMonadProcess } = await import('monad.ai');

const reservedPort = await reservePort();
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
const originGuard = installMonadOriginGuard([expectedOrigin]);
const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);
const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
assert.ok(ownRecord && ownRecord.port === reservedPort, 'the disposable monad is registered under its own name and port');
assert.equal(await getNetgetMonadOrigin(), expectedOrigin, 'resolves to THIS test\'s monad');

const mapOf = () => JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8')).domains as Record<string, any>;

try {
  await registerDomain(door, door, 'admin@neurons.me', '', '', '', 'app:fulltrailer', 'server', '', 'test-owner');
  await registerDomain(staticDoor, staticDoor, 'admin@neurons.me', '', '', '', '/srv/static', 'static', '', 'test-owner');

  // 1. none to begin with
  assert.deepEqual((await getDomainByName(door))?.connections, []);
  await generateDomainMap();
  assert.equal(mapOf()[door].connections, undefined, 'no connections key when there are none');

  // 2. declared: normalized, stored, projected into domain-map.json (which regenerates by itself)
  const declared = await updateDomainConnections(door, [
    { prefix: '/api/fuel', target: 'localhost:4000' },
    { prefix: '/api/upload', target: 'http://127.0.0.1:4000' },
    { prefix: '/uploads', target: '127.0.0.1:4000' },
  ]);
  assert.deepEqual(declared.map((c) => c.target), ['127.0.0.1:4000', '127.0.0.1:4000', '127.0.0.1:4000'], 'localhost/http:// normalized');
  assert.deepEqual((await getDomainByName(door))?.connections, declared);
  assert.deepEqual(mapOf()[door].connections, declared, 'the map carries the same list');
  assert.equal(mapOf()[door].type, 'server');
  assert.equal(mapOf()[door].target, 'app:fulltrailer', 'the door\'s destination is untouched');

  // 3. an invalid list is refused as a whole and writes nothing
  await assert.rejects(updateDomainConnections(door, [{ prefix: '/api/fuel', target: '127.0.0.1:4000' }, { prefix: '/api', target: '127.0.0.1:4000' }]), /connection #2 refused.*\/api\/v1/);
  await assert.rejects(updateDomainConnections(door, [{ prefix: '/x', target: '127.0.0.1:3000' }]), /gateway/);
  await assert.rejects(updateDomainConnections(door, [{ prefix: '/x', target: '10.0.0.5:4000' }]), /loopback/);
  await assert.rejects(updateDomainConnections(door, 'not a list'), /list/);
  assert.deepEqual((await getDomainByName(door))?.connections, declared, 'the previous declaration is still there');

  // 4. a port that belongs to a registered monad is refused (reached by app name, not by port)
  fs.writeFileSync(path.join(tmpDataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: {
    m: { name: 'monad:fulltrailer', port: 4100, host: '127.0.0.1', lastSeenMs: Date.now(), ttlMs: 12000, metadata: { endpoint: 'http://127.0.0.1:4100' } },
    n: { name: 'monad:netget', port: 8161, host: '127.0.0.1', lastSeenMs: 1, ttlMs: 12000, metadata: { directEndpoint: 'http://127.0.0.1:8161' } },
  } }));
  await assert.rejects(updateDomainConnections(door, [{ prefix: '/api/fuel', target: '127.0.0.1:4100' }]), /registered monad/);
  await assert.rejects(updateDomainConnections(door, [{ prefix: '/api/fuel', target: '127.0.0.1:8161' }]), /registered monad/, 'a stale registration still reserves its port');

  // 5. a domain that is not registered
  await assert.rejects(updateDomainConnections(`nobody-${process.pid}.example`, [{ prefix: '/api/fuel', target: '127.0.0.1:4000' }]), /not registered/);

  // 6. a stored value that is not valid reads as none, and a port that became a registered monad drops the list from
  //    the map instead of projecting a partial one
  await updateDomainConnections(door, [{ prefix: '/api/fuel', target: '127.0.0.1:4200' }]);
  await generateDomainMap();
  assert.equal(mapOf()[door].connections?.length, 1);
  fs.writeFileSync(path.join(tmpDataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: {
    p: { name: 'monad:polls', port: 4200, host: '127.0.0.1', lastSeenMs: Date.now(), ttlMs: 12000, metadata: {} },
  } }));
  await generateDomainMap();
  assert.equal(mapOf()[door].connections, undefined, 'the list names a registered monad now: not projected');
  assert.deepEqual((await getDomainByName(door))?.connections, [], 'and reads as none');

  // 7. a static folder has nothing to carve out of: stored, never projected
  fs.writeFileSync(path.join(tmpDataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: {} }));
  await updateDomainConnections(staticDoor, [{ prefix: '/api/fuel', target: '127.0.0.1:4000' }]);
  assert.equal(mapOf()[staticDoor].connections, undefined);

  // 8. cleared
  await updateDomainConnections(door, []);
  assert.equal(mapOf()[door].connections, undefined);
  assert.deepEqual((await getDomainByName(door))?.connections, []);

  console.log('domain-connections-store: ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
process.exit(0);
