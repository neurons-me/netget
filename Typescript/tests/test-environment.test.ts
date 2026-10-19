import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestEnvironment, withTestEnvironment } from './helpers/testEnvironment.ts';

// The test environment tool: what it creates, that two do not see each other, that it never reaches the machine's
// monad, and that it closes -- process, port and storage -- on success and when the test inside it fails.

const REAL_PORTS = [3000, 8161];

// 1. creation: a namespace, a transport, identities that exist in it, data that reads back
const a = await createTestEnvironment({ identities: ['alice', 'bob'], seed: { 'profile.motto': 'from-env-a' } });
const b = await createTestEnvironment({ identities: ['carol'] });
try {
  assert.match(a.namespace, /^env-[0-9a-f]{10}\.test$/);
  assert.notEqual(a.namespace, b.namespace);
  assert.notEqual(a.port, b.port);
  assert.ok(!REAL_PORTS.includes(a.port) && !REAL_PORTS.includes(b.port), 'never the machine\'s ports');
  assert.equal(a.transport, `http://127.0.0.1:${a.port}`);
  assert.deepEqual(a.identities.map((i) => i.username), ['alice', 'bob']);
  assert.equal(a.identities[0].namespace, `alice.${a.namespace}`);
  assert.deepEqual(a.status(), { processAlive: true, listening: true, storageExists: true });

  // all of its storage is under its own directory (nothing under the machine's ~/.monad or ~/.get)
  assert.ok(a.dir.includes('netget-testenv-'));
  assert.ok(fs.existsSync(`${a.dir}/home/.monad/monads`) || fs.existsSync(`${a.dir}/monad/me-state`), 'state lives under the environment dir');

  // the seeded value reads back from A, and is not in B
  const motto = await a.read('/profile.motto');
  assert.ok(JSON.stringify(motto).includes('from-env-a'), `seeded value reads back: ${JSON.stringify(motto).slice(0, 200)}`);
  assert.ok(!JSON.stringify(await b.read('/profile.motto')).includes('from-env-a'), 'B does not see A\'s data');

  // identities: A knows alice and bob, not carol; B knows carol, not alice
  const usersA = JSON.stringify(await a.read('/'));
  const usersB = JSON.stringify(await b.read('/'));
  assert.ok(usersA.includes('alice') && usersA.includes('bob') && !usersA.includes('carol'), 'A has its own identities only');
  assert.ok(usersB.includes('carol') && !usersB.includes('alice'), 'B has its own identities only');
} finally {
  const ca = await a.stop();
  const cb = await b.stop();
  assert.deepEqual(ca, { processGone: true, portClosed: true, storageRemoved: true });
  assert.deepEqual(cb, { processGone: true, portClosed: true, storageRemoved: true });
}
assert.equal(fs.existsSync(a.dir), false);

// 2. the callback form closes the environment when the test inside it FAILS, and the failure still reaches the caller
let seen: { dir: string; pid: number; port: number } | undefined;
await assert.rejects(
  withTestEnvironment({ identities: ['dave'] }, async (env) => {
    seen = { dir: env.dir, pid: env.pid, port: env.port };
    assert.equal(env.status().listening, true);
    throw new Error('the test inside failed');
  }),
  /the test inside failed/,
);
assert.ok(seen);
assert.equal(fs.existsSync(seen!.dir), false, 'storage removed after a failing test');
assert.throws(() => process.kill(seen!.pid, 0), 'process gone after a failing test');
const stillOpen = await new Promise<boolean>((resolve) => {
  import('node:net').then(({ default: net }) => {
    const c = net.connect(seen!.port, '127.0.0.1', () => { c.destroy(); resolve(true); });
    c.on('error', () => resolve(false));
  });
});
assert.equal(stillOpen, false, 'port closed after a failing test');

// 3. a successful callback returns its value and also closes
const value = await withTestEnvironment({}, async (env) => ({ ns: env.namespace, dir: env.dir }));
assert.equal(fs.existsSync(value.dir), false);

console.log('test-environment: ok');
process.exit(0);
