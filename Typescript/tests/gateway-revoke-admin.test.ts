/**
 * Proves GatewayClaimsManager.revokeAdmin() actually revokes — both in
 * the materialized local snapshot AND in the authorization primitives
 * (isAdmin()/hasScope()) any real access check calls.
 *
 * WHY THIS TEST EXISTS SPECIFICALLY
 * revokeAdmin() goes through the exact same writeLedger()->operator:"-"
 * path that gateway-delete-operator-restart.test.ts's incident exposed
 * as broken (see that file, and modules/monad/Typescript/tests/
 * semanticDeleteOperator.test.ts, for the root cause and fix). Before
 * that fix, revokeAdmin() could plausibly have never actually removed
 * anyone in production — the local snapshot's `admins`/`grants`/etc.
 * maps are rebuilt by re-reading the ledger after every write
 * (materializeFromLedger()), and if the ledger never actually dropped
 * the revoked identity's entries, the "revoked" admin would keep coming
 * back on the very next materialization. This test would have failed
 * against the pre-fix code — that's the point of keeping it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-revoke-admin-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
const TEST_MONAD_NAME = `netget-revoke-admin-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { startNetgetMonad } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { deleteMonadProcess } = await import('monad.ai');

const OWNER_HASH = 'a'.repeat(64);
const ADMIN_HASH = 'b'.repeat(64);

try {
  const startStatus = await startNetgetMonad();
  assert.ok(startStatus.running, `isolated test monad must start: ${startStatus.message}`);

  const mgr = new GatewayClaimsManager();
  await mgr.bootstrapOwner(OWNER_HASH, 'owner-pubkey-b64', undefined, 'owner-user');
  await mgr.grantAdmin(ADMIN_HASH, 'admin-pubkey-b64', ['domains:read', 'domains:write'], 'admin-user');

  // Before revocation: an operation gated on either primitive is
  // authorized — this IS "an operation previously authorized," expressed
  // through the exact methods a real access check calls (isAdmin/
  // hasScope), not a hypothetical.
  assert.equal(mgr.isAdmin(ADMIN_HASH), true, 'admin must be recognized before revocation');
  assert.equal(mgr.hasScope(ADMIN_HASH, 'domains:write'), true, 'granted scope must be honored before revocation');

  await mgr.revokeAdmin(ADMIN_HASH);

  // Effective rejection: the exact same checks, now on the revoked
  // identity, must flip to false — this is the operation actually being
  // rejected, not just data disappearing from a display.
  assert.equal(mgr.isAdmin(ADMIN_HASH), false, 'revoked identity must no longer be recognized as admin');
  assert.equal(mgr.hasScope(ADMIN_HASH, 'domains:write'), false, 'revoked identity must no longer hold any scope');
  assert.deepEqual(mgr.getScopes(ADMIN_HASH), [], 'revoked identity must have no scopes at all');

  // Materialized state: the local snapshot (re-derived from the ledger
  // on every write) must not list the revoked identity anywhere, while
  // the owner's own entries stay fully intact.
  const materialized = mgr.read();
  assert.ok(materialized);
  assert.equal(ADMIN_HASH in materialized!.admins, false, 'materialized snapshot must not list the revoked admin');
  assert.equal(ADMIN_HASH in materialized!.grants, false);
  assert.equal(ADMIN_HASH in materialized!.pubkeys, false);
  assert.equal(ADMIN_HASH in materialized!.usernames, false);
  assert.equal(materialized!.owner, OWNER_HASH, 'owner must be untouched by revoking a different identity');
  assert.equal(materialized!.admins[OWNER_HASH], true);
  assert.equal(materialized!.usernames[OWNER_HASH], 'owner-user');

  // Ledger, read directly (not through the manager's own materialization
  // logic) — the same double-check gateway-delete-operator-restart.test.ts
  // uses, so this test doesn't just trust GatewayClaimsManager's own
  // re-read of the thing it just wrote.
  const { readFromMonad } = await import('../src/kernel/monadHttpClient.ts');
  const { getNetgetMonadOrigin, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
  const origin = await getNetgetMonadOrigin();
  const ns = getGatewayRootNamespace();
  const ledgerBranch = (await readFromMonad(origin, ns, 'netget')).value as any;
  assert.equal(ADMIN_HASH in (ledgerBranch.admins || {}), false, 'ledger itself must not list the revoked admin');
  assert.equal(ledgerBranch.admins[OWNER_HASH], true);

  console.log('gateway-revoke-admin ok');
} finally {
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
