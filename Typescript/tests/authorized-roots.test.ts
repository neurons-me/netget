/**
 * authorized-roots.test.ts -- who may be handed the names under a root.
 *
 * A monad announces a root (capability); the router hands names under a root only to the identity AUTHORIZED for it: the
 * installation's own configured root, bound to the identity of the monad netget started (domain-map.json `roots`), or an
 * operator's wildcard route. These are the pieces on the netget side of that: the installation's root, and the only shape
 * a wildcard may take. (The router's decisions are in surface-proxy-selection.test.ts section 9, through nginx in
 * named-spaces-localhost.test.ts, and the projection through the real backend in standalone-backend-gate.test.ts.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'authorized-roots-'));
const monadsHome = path.join(tmp, 'monads');
process.env.HOME = tmp;
process.env.MONADS_HOME = monadsHome;
process.env.NETGET_DATA_DIR = path.join(tmp, 'data');
process.env.NETGET_MONAD_NAME = 'roots-test-monad';
process.env.NETGET_MONAD_NAMESPACE = 'LocalHost';       // spelled as an operator might; the root is lower-cased

const { installationRoots, isValidDomainPattern } = await import('../src/runtime/authorizedRoots.ts');

try {
  // no record yet: nothing is authorized (an address then gets the neutral shell, never a guess)
  assert.deepEqual(await installationRoots(), {});

  // the monad's record carries its identity; the installation's root is bound to it
  const dir = path.join(monadsHome, 'roots-test-monad');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'monad.json'), JSON.stringify({ name: 'roots-test-monad', status: 'running', identity_hash: 'abc123identity' }));
  assert.deepEqual(await installationRoots(), { localhost: { app: 'roots-test-monad', identity: 'abc123identity', source: 'installation' } });

  // a record with no identity authorizes nothing
  fs.writeFileSync(path.join(dir, 'monad.json'), JSON.stringify({ name: 'roots-test-monad', status: 'running' }));
  assert.deepEqual(await installationRoots(), {});

  // only `*.<name>` is a wildcard
  for (const ok of ['*.localhost', '*.casa.me', '*.a-b.c', 'plain.test', 'localhost']) assert.equal(isValidDomainPattern(ok), true, ok);
  for (const bad of ['*', '**.x', 'a*.x', '*a.x', '*.*.x', 'x.*', '*.', '*..x', '*.-x', '*.x_y']) assert.equal(isValidDomainPattern(bad), false, bad);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('authorized-roots: ok');
