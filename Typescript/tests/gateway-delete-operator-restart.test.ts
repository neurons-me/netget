/**
 * Proves the real-restart half of the semantic-delete guarantee — see
 * modules/monad/Typescript/tests/semanticDeleteOperator.test.ts for the
 * within-one-process half (hides the value, preserves siblings/other
 * identities, allows a legitimate rewrite) and its own header comment on
 * why an in-process "restart" simulation isn't used for persistence:
 * it produced an unexplained quirk unrelated to the actual fix, so this
 * file proves persistence the way it actually happens in production —
 * a real, separate OS process stopping and starting again — using
 * netget's own NETGET_MONAD_NAME isolation seam (ledgerIdentity.ts/
 * netgetMonadProcess.ts) so it never touches a real ambient monad (see
 * gateway-setup-session.test.ts's own header comment for the 2026-09
 * incident that seam exists to prevent recurring).
 *
 * INCIDENT THIS GUARDS AGAINST (2026-09)
 * A gateway-ownership repair sent operator:"-" writes expecting four
 * stale entries to disappear. They didn't survive a point read, a tree
 * read, OR a restart — the delete silently behaved as an unconditional
 * overwrite. Root-caused to `.me`'s execute()/postulate() chain and
 * monad.ai's kernelWrite() both dropping the operator argument before it
 * ever reached the kernel; fixed in me/Typescript's core.ts/me.ts/
 * types.ts and modules/monad/Typescript's memoryStore.ts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-delete-restart-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
const TEST_MONAD_NAME = `netget-delete-restart-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { startNetgetMonad, stopNetgetMonad, getNetgetMonadOrigin, getGatewayRootNamespace } =
  await import('../src/kernel/netgetMonadProcess.ts');
const { writeToMonad, readFromMonad } = await import('../src/kernel/monadHttpClient.ts');
const { deleteMonadProcess } = await import('monad.ai');

async function raw(pathExpr: string, value: unknown, operator?: '-') {
  const origin = await getNetgetMonadOrigin();
  const ns = getGatewayRootNamespace();
  await writeToMonad(origin, ns, pathExpr, value, operator);
}
async function rawRead(pathExpr: string) {
  const origin = await getNetgetMonadOrigin();
  const ns = getGatewayRootNamespace();
  return readFromMonad(origin, ns, pathExpr);
}

try {
  const startStatus = await startNetgetMonad();
  assert.ok(startStatus.running, `isolated test monad must start: ${startStatus.message}`);

  // Seed: a target key, a sibling, and an unrelated identity — same
  // shape as the real incident (one bogus identity's entries next to
  // other real ones).
  await raw('team.admins.real-id', true);
  await raw('team.admins.other-id', true);
  await raw('team.grants.real-id', ['scope:read', 'scope:write']);
  await raw('team.grants.other-id', ['scope:read']);
  await raw('team.admins.target-id', true);
  await raw('team.grants.target-id', true);

  const before = (await rawRead('team')).value as any;
  assert.deepEqual(before.admins, { 'real-id': true, 'other-id': true, 'target-id': true });

  // The delete: operator "-", exactly the shape the real repair sends.
  await raw('team.admins.target-id', true, '-');
  await raw('team.grants.target-id', true, '-');

  const afterDelete = (await rawRead('team')).value as any;
  assert.deepEqual(afterDelete.admins, { 'real-id': true, 'other-id': true }, 'deleted key must be gone, siblings intact');
  assert.deepEqual(afterDelete.grants, { 'real-id': ['scope:read', 'scope:write'], 'other-id': ['scope:read'] });

  const pointRead = await rawRead('team.admins.target-id');
  assert.equal(pointRead.value, undefined, 'point read of a deleted key must be undefined, not the placeholder value');

  // Real restart: stop the process, start it again (same isolated name,
  // same on-disk state — NOT delete+recreate, which would just produce a
  // fresh empty ledger and prove nothing about persistence).
  await stopNetgetMonad();
  const restarted = await startNetgetMonad();
  assert.ok(restarted.running, `isolated test monad must restart cleanly: ${restarted.message}`);

  const afterRestart = (await rawRead('team')).value as any;
  assert.deepEqual(afterRestart.admins, { 'real-id': true, 'other-id': true }, 'deletion must survive a real process restart');
  assert.equal((await rawRead('team.admins.target-id')).value, undefined);

  // A legitimate subsequent write to the same, now-deleted path must
  // succeed normally — deleting must not poison the path.
  await raw('team.admins.target-id', true);
  assert.equal((await rawRead('team.admins.target-id')).value, true, 'a legitimate write after a delete must succeed normally');

  console.log('gateway-delete-operator-restart ok');
} finally {
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
