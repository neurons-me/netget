/**
 * Proves revoking a gateway administrator actually revokes — in the
 * canonical authority branch on the monad, in the local snapshot, and in the
 * authorization primitives (isAdmin()/hasScope()/getScopes()) any real access
 * check calls — and that it STAYS revoked across a fresh manager and a real
 * monad process restart.
 *
 * WHY THIS TEST EXISTS SPECIFICALLY
 * Revocation used to go through the writeLedger()->operator:"-" path that
 * gateway-delete-operator-restart.test.ts's incident exposed as broken (see
 * that file, and modules/monad/Typescript/tests/semanticDeleteOperator.test.ts).
 * A "revoked" admin whose entries never actually left the stored tree comes
 * back on the very next re-materialization. The same failure shape is still
 * possible on today's path: the monad persists the authority record with a
 * whole-object kernelSet() after a JS `delete`, so a merge-instead-of-replace
 * in the kernel would silently resurrect the admin after a restart. Hence the
 * restart half below.
 *
 * WHICH REVOKE PATH THIS COVERS, AND WHY NOT GatewayClaimsManager.revokeAdmin()
 * This file previously drove the legacy GatewayClaimsManager.bootstrapOwner()/
 * grantAdmin()/revokeAdmin() against a disposable monad. Those write through
 * an UNSIGNED writeToMonad(), which no monad state accepts: an unclaimed
 * namespace refuses any netget.* write (NETGET_PATH_REQUIRES_CLAIM) and a
 * claimed one refuses an unsigned write (NAMESPACE_WRITE_FORBIDDEN). Claiming
 * the namespace first therefore does not make the legacy path work (verified
 * both ways); it only changes which 403 you get. The legacy methods are kept
 * for the self-owned-ledger model (gateway-claims.test.ts, fake ledger); the
 * path that actually runs against a real monad is the signed one —
 * gatewayAdminActions.revokeGatewayAdmin() — which is what this exercises.
 * The legacy revokeAdmin()'s local-snapshot semantics are checked at the end
 * in its local-only mode ({ ledger: false }).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-revoke-admin-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
const TEST_MONAD_NAME = `netget-revoke-admin-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

// The gateway's root namespace must be one the disposable monad can hold
// claims under, as in a real deployment (see
// gateway-claims-live-write-integration.test.ts for the same setup).
const ROOT_NAMESPACE = `revoke-admin-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = ROOT_NAMESPACE;
const GATEWAY_ID = 'revoke-admin-test.local';

const { startNetgetMonad, stopNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { grantGatewayAdmin, revokeGatewayAdmin } = await import('../src/modules/NetGetX/Auth/gatewayAdminActions.ts');
const { deleteMonadProcess, issueInstallationAuthorization, readMonadRecord } = await import('monad.ai');
const { claimIdentityWithKey } = await import('./helpers/testIdentities.ts');
const { meDistUrl } = await import('./_meDist.ts');
// @ts-expect-error -- no .d.ts resolution across this path; the runtime import reaches the workspace build.
const { normalizeProofMessage } = await import(meDistUrl());

type Who = Awaited<ReturnType<typeof claimIdentityWithKey>>;

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function signedGrant(acting: Who, target: Who, scopes: string[]) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = {
    op: 'gateway-grant-admin', gatewayId: GATEWAY_ID, namespace: acting.namespace,
    targetIdentityHash: target.identityHash, targetNamespace: target.namespace,
    targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp,
  };
  const signature = await acting.sign(normalizeProofMessage(signedFields));
  return grantGatewayAdmin({
    gatewayId: GATEWAY_ID, namespace: acting.namespace, actingKeyId: acting.keyId,
    targetIdentityHash: target.identityHash, targetNamespace: target.namespace,
    targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp, signature,
  });
}

async function signedRevoke(acting: Who, targetIdentityHash: string) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'gateway-revoke-admin', gatewayId: GATEWAY_ID, namespace: acting.namespace, targetIdentityHash, nonce, timestamp };
  const signature = await acting.sign(normalizeProofMessage(signedFields));
  return revokeGatewayAdmin({ gatewayId: GATEWAY_ID, namespace: acting.namespace, actingKeyId: acting.keyId, targetIdentityHash, nonce, timestamp, signature });
}

/** The canonical branch, read straight from the monad (not through GatewayClaimsManager's own materialization). */
async function readAuthority(origin: string) {
  const res = await fetch(`${origin}/api/v1/gateway/${encodeURIComponent(GATEWAY_ID)}/authority`);
  assert.equal(res.status, 200, 'authority endpoint must answer');
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  return body.record as { owner: string; admins: Record<string, true>; grants: Record<string, string[]>; pubkeys: Record<string, string>; usernames: Record<string, string> };
}

function assertRevoked(mgr: InstanceType<typeof GatewayClaimsManager>, who: Who, label: string) {
  assert.equal(mgr.isAdmin(who.identityHash), false, `${label}: revoked identity must not be recognized as admin`);
  assert.equal(mgr.hasScope(who.identityHash, 'domains:write'), false, `${label}: revoked identity must hold no scope`);
  assert.equal(mgr.hasScope(who.identityHash, 'domains:read'), false, `${label}: revoked identity must hold no scope`);
  assert.deepEqual(mgr.getScopes(who.identityHash), [], `${label}: revoked identity must have no scopes at all`);
  const snap = mgr.read()!;
  assert.equal(who.identityHash in snap.admins, false, `${label}: snapshot must not list the revoked admin`);
  assert.equal(who.identityHash in snap.grants, false, `${label}: snapshot grants`);
  assert.equal(who.identityHash in (snap.pubkeys ?? {}), false, `${label}: snapshot pubkeys`);
  assert.equal(who.identityHash in (snap.usernames ?? {}), false, `${label}: snapshot usernames`);
}

const reservedPort = await reservePort();
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
const originGuard = installMonadOriginGuard([expectedOrigin]);

try {
  const startStatus = await startNetgetMonad({ port: reservedPort });
  assert.ok(startStatus.running, `isolated test monad must start: ${startStatus.message}`);
  const origin = startStatus.origin;
  assert.equal(getGatewayRootNamespace(), ROOT_NAMESPACE, 'NETGET_MONAD_NAMESPACE override must be in effect');

  // The mesh registry entry the signed actions resolve the monad through (same seeding as the sibling live tests).
  const registryDir = path.join(tmpDataDir, 'runtime');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    apps: { 'test-surface': {
      id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0, lastSeenMs: Date.now(), ttlMs: 3_600_000, trust: 'owner',
      metadata: { namespace: ROOT_NAMESPACE, endpoint: origin }, tags: [],
    } },
  }, null, 2), 'utf8');

  // Three real claimed identities, each with its own keychain key: the owner, the admin to be revoked, and a second
  // admin who must be left untouched by that revocation.
  const owner = await claimIdentityWithKey(origin, 'owner1', 'owner1-secret', ROOT_NAMESPACE);
  const victim = await claimIdentityWithKey(origin, 'victim1', 'victim1-secret', ROOT_NAMESPACE);
  const keeper = await claimIdentityWithKey(origin, 'keeper1', 'keeper1-secret', ROOT_NAMESPACE);

  const monadRecord = await readMonadRecord(TEST_MONAD_NAME);
  assert.ok(monadRecord, 'the disposable monad must have a real process record');
  const authIssued = issueInstallationAuthorization({
    stateDir: monadRecord!.stateDir, gatewayId: GATEWAY_ID, namespace: owner.namespace, identityHash: owner.identityHash,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  assert.ok(authIssued.ok, `installation authorization must be issuable: ${JSON.stringify(authIssued)}`);

  const challenge = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const bootstrapSignature = await owner.sign(normalizeProofMessage({
    op: 'netget-claim-gateway', gatewayId: GATEWAY_ID, namespace: owner.namespace, identityHash: owner.identityHash, keyId: owner.keyId, challenge, timestamp,
  }));
  const bootstrap = await post(origin, `/api/v1/gateway/${GATEWAY_ID}/bootstrap`, {
    namespace: owner.namespace, identityHash: owner.identityHash, keyId: owner.keyId, challenge, timestamp, signature: bootstrapSignature, username: owner.identityHash,
  });
  assert.equal(bootstrap.status, 201, `bootstrap must succeed: ${JSON.stringify(bootstrap.json)}`);

  const mgr = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await mgr.materializeFromGatewayAuthority(origin);
  assert.equal(mgr.read()?.owner, owner.identityHash);

  assert.equal((await signedGrant(owner, victim, ['domains:read', 'domains:write'])).ok, true, 'grant to the identity to be revoked');
  assert.equal((await signedGrant(owner, keeper, ['domains:read'])).ok, true, 'grant to the identity that must survive');

  // Positive control: before revocation the very same checks say yes, so the post-revocation "no" is a change, not a default.
  await mgr.materializeFromGatewayAuthority(origin);
  assert.equal(mgr.isAdmin(victim.identityHash), true, 'admin must be recognized before revocation');
  assert.equal(mgr.hasScope(victim.identityHash, 'domains:write'), true, 'granted scope must be honored before revocation');
  assert.equal(victim.identityHash in (await readAuthority(origin)).admins, true);

  const revoke = await signedRevoke(owner, victim.identityHash);
  assert.equal(revoke.ok, true, `revokeGatewayAdmin must succeed: ${(revoke as any).message}`);

  // 1. The effective checks and the local snapshot, as updated by the revoke call itself.
  assertRevoked(mgr, victim, 'right after revoke');

  // 2. The canonical branch, read directly.
  const authority = await readAuthority(origin);
  assert.equal(victim.identityHash in authority.admins, false, 'canonical admins must not list the revoked identity');
  assert.equal(victim.identityHash in authority.grants, false, 'canonical grants');
  assert.equal(victim.identityHash in (authority.pubkeys ?? {}), false, 'canonical pubkeys');
  assert.equal(victim.identityHash in (authority.usernames ?? {}), false, 'canonical usernames');

  // 3. Others untouched: the owner keeps everything, the other admin keeps exactly their own grant.
  assert.equal(authority.owner, owner.identityHash);
  assert.equal(authority.admins[owner.identityHash], true);
  assert.equal(authority.admins[keeper.identityHash], true, 'revoking one admin must not remove another');
  assert.deepEqual(authority.grants[keeper.identityHash], ['domains:read']);
  assert.equal(mgr.isAdmin(owner.identityHash), true);
  assert.equal(mgr.isAdmin(keeper.identityHash), true);
  assert.equal(mgr.hasScope(keeper.identityHash, 'domains:read'), true);

  // 4. Real rejection: the revoked identity still holds a valid, active keychain key, yet can no longer exercise
  //    gateway authority (grant to anyone) nor revoke anyone else.
  const revokedGrant = await signedGrant(victim, victim, ['domains:write']);
  assert.equal(revokedGrant.ok, false, 'a revoked admin must not be able to grant');
  assert.equal((revokedGrant as any).message, 'PERMISSION_DENIED');
  const revokedRevoke = await signedRevoke(victim, keeper.identityHash);
  assert.equal(revokedRevoke.ok, false, 'a revoked admin must not be able to revoke');
  assert.equal((revokedRevoke as any).message, 'PERMISSION_DENIED');
  assert.equal((await readAuthority(origin)).admins[keeper.identityHash], true, 'the refused revoke must change nothing');

  // 5. The owner cannot be revoked (lockout guard), even by the owner.
  const ownerRevoke = await signedRevoke(owner, owner.identityHash);
  assert.equal(ownerRevoke.ok, false);
  assert.equal((ownerRevoke as any).message, 'CANNOT_REVOKE_OWNER');

  // 6. A fresh manager (no memory of the revoke) re-materializing from the canonical branch stays revoked.
  const fresh = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await fresh.materializeFromGatewayAuthority(origin);
  assertRevoked(fresh, victim, 'fresh manager');
  assert.equal(fresh.read()?.owner, owner.identityHash);

  // 7. A real process restart (same state dir — NOT delete+recreate): the revocation must be what was persisted.
  const stopped = await stopNetgetMonad();
  assert.ok(stopped.ok, `isolated test monad must stop: ${stopped.message}`);
  const restarted = await startNetgetMonad({ port: reservedPort });
  assert.ok(restarted.running, `isolated test monad must restart: ${restarted.message}`);

  const afterRestart = await readAuthority(restarted.origin);
  assert.equal(victim.identityHash in afterRestart.admins, false, 'revocation must survive a real monad restart (canonical admins)');
  assert.equal(victim.identityHash in afterRestart.grants, false, 'revocation must survive a real monad restart (canonical grants)');
  assert.equal(afterRestart.admins[keeper.identityHash], true);
  const mgrAfterRestart = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await mgrAfterRestart.materializeFromGatewayAuthority(restarted.origin);
  assertRevoked(mgrAfterRestart, victim, 'after monad restart');
  assert.equal(mgrAfterRestart.isAdmin(keeper.identityHash), true);

  // 8. Legacy GatewayClaimsManager.revokeAdmin() in its local-only mode: same snapshot semantics, owner protected.
  // (it shares the local gateway-claims.json with the manager above, so start from an empty snapshot)
  const legacy = new GatewayClaimsManager('revoke-admin-legacy.local', { ledger: false });
  await legacy.reset();
  await legacy.bootstrapOwner('a'.repeat(64), 'owner-pubkey-b64', undefined, 'owner-user');
  await legacy.grantAdmin('b'.repeat(64), 'admin-pubkey-b64', ['domains:read', 'domains:write'], 'admin-user');
  assert.equal(legacy.isAdmin('b'.repeat(64)), true);
  await legacy.revokeAdmin('b'.repeat(64));
  assert.equal(legacy.isAdmin('b'.repeat(64)), false);
  assert.equal(legacy.hasScope('b'.repeat(64), 'domains:write'), false);
  assert.deepEqual(legacy.getScopes('b'.repeat(64)), []);
  assert.equal('b'.repeat(64) in legacy.read()!.pubkeys, false);
  assert.equal('b'.repeat(64) in legacy.read()!.usernames, false);
  assert.equal(legacy.isAdmin('a'.repeat(64)), true, 'owner untouched by revoking another identity');
  await assert.rejects(() => legacy.revokeAdmin('a'.repeat(64)), /Cannot revoke the gateway owner/);

  console.log('gateway-revoke-admin ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
}
