import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A one-label declared root (`localhost`) makes every handle under it a TWO-label namespace. The surface
// resolver strips one handle label only from 3+ labels, so "alice.localhost" never reduced to the root the
// monad's surface claims and admin sign-in / claiming the gateway failed with NAMESPACE_SURFACE_NOT_FOUND.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-surface-root-'));
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.HOME = path.join(dataDir, 'home');
process.env.NETGET_MONAD_NAMESPACE = 'localhost';

const { rootspaceOf, resolveSurface } = await import('../src/kernel/topologyResolver.ts');

// the pure reduction
assert.equal(rootspaceOf('alice.localhost', ['localhost']), 'localhost', 'a handle under a declared one-label root reduces to it');
assert.equal(rootspaceOf('ALICE.Localhost', ['LOCALHOST']), 'localhost', 'case is folded');
assert.equal(rootspaceOf('localhost', ['localhost']), 'localhost', 'the root itself is unchanged');
assert.equal(rootspaceOf('alice.localhost'), 'alice.localhost', 'with nothing declared, the old rule: a 2-label name stays whole');
assert.equal(rootspaceOf('x.com', ['localhost']), 'x.com', 'an undeclared 2-label name stays whole');
assert.equal(rootspaceOf('alice.cleaker.me', ['localhost']), 'cleaker.me', '3+ labels: unchanged, one handle label stripped');
assert.equal(rootspaceOf('jabellae.suis-macbook-air.local'), 'suis-macbook-air.local');

// through the registry: one live surface claiming `localhost`
const now = Date.now();
fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
  version: 1, updatedAt: new Date().toISOString(),
  apps: { 'monad:netget': {
    id: 'monad:netget', name: 'netget', host: '127.0.0.1', port: 8161, lastSeenMs: now, ttlMs: 60_000, trust: 'owner',
    metadata: { namespace: 'localhost', endpoint: 'http://127.0.0.1:8161' }, tags: [],
  } },
}));
const found = await resolveSurface({ namespace: 'alice.localhost' });
assert.equal(found?.url, 'http://127.0.0.1:8161', 'alice.localhost resolves to the surface that claims localhost');
assert.equal((await resolveSurface({ namespace: 'localhost' }))?.url, 'http://127.0.0.1:8161');
assert.equal(await resolveSurface({ namespace: 'alice.example.test' }), null, 'a namespace under another root does not');
assert.equal(await resolveSurface({ namespace: 'alice.com' }), null, 'an undeclared 2-label name does not match a surface claiming a different root');

fs.rmSync(dataDir, { recursive: true, force: true });
console.log('surface-resolution-declared-root: ok');
