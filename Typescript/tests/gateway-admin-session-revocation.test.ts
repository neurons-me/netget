/**
 * gateway-admin-session-revocation.test.ts — proves gateway-admin
 * revocation (claim/gatewayAuthority.ts's revokeGatewayAdmin, forwarded
 * through gatewayAdminActions.ts) actually takes effect against a LIVE
 * admin session (adminSession.ts), not just against a future one.
 *
 * WHY THIS FILE EXISTS
 * admin-session-live-keychain.test.ts already proves a session dies the
 * instant its SIGNING KEY is revoked. This is the analogous, previously
 * unverified guarantee for the ORTHOGONAL axis: a session must ALSO die
 * the instant the identity itself loses GATEWAY admin status (a
 * revokeGatewayAdmin call through the new E+A mechanism), using the exact
 * same still-active, never-revoked key throughout. adminSession.ts's own
 * resolveAdminSession() re-checks claims.isAdmin() fresh on every call —
 * this file is the live proof that "fresh" genuinely means "reflects a
 * revoke that happened through the real canonical-branch mechanism, not
 * just the old local-only model."
 *
 * Real disposable monad throughout, never the real ambient one.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gwauth-revocation-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const TEST_MONAD_NAME = `gwauth-revocation-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const CLAIMED_NAMESPACE = `gwauth-revocation-owner-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = CLAIMED_NAMESPACE;

const GATEWAY_ID = 'gwauth-revocation-test.local';

const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { grantGatewayAdmin, revokeGatewayAdmin } = await import('../src/modules/NetGetX/Auth/gatewayAdminActions.ts');
const { issueAdminSessionChallenge, verifyAdminSessionChallenge, resolveAdminSession } =
  await import('../src/modules/NetGetX/Auth/adminSession.ts');
const { deleteMonadProcess, issueInstallationAuthorization, readMonadRecord } = await import('monad.ai');
// @ts-expect-error -- no .d.ts resolution across this relative path; see
// gateway-setup-session.test.ts's identical note.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } =
  await import('../../../../me/Typescript/dist/me.es.js');

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

async function claimTestIdentity(origin: string, username: string, secret: string, rootNamespace: string) {
  const namespace = `${username}.${rootNamespace}`;
  const identityHash = username;
  const branchSeed = await deriveBranchProofSeed(secret, username);
  const { privateKey, publicKey } = await importEd25519SigningKey(branchSeed);
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  const timestamp = Date.now();
  const proofPayload = { identityHash, expression: username, namespace, rootNamespace, challenge: null, timestamp };
  const proofMessage = normalizeProofMessage(proofPayload);
  const proofSignature = await signEd25519Proof(privateKey, proofMessage);
  const claimRes = await post(origin, '/', {
    operation: 'claim', namespace, secret, identityHash,
    proof: { message: proofMessage, signature: proofSignature, publicKey: publicKeyRaw, timestamp },
  });
  if (claimRes.status !== 201) throw new Error(`Test setup failed: identity claim returned ${claimRes.status} ${JSON.stringify(claimRes.json)}`);
  return { namespace, identityHash, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

async function generateDeviceKey() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const { privateKey, publicKey } = await importEd25519SigningKey(seed);
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  return { publicKeyRaw, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

type TestIdentity = Awaited<ReturnType<typeof claimTestIdentity>>;
type DeviceKey = Awaited<ReturnType<typeof generateDeviceKey>>;

async function registerFirstKeychainKey(origin: string, identity: TestIdentity, key: DeviceKey, label: string) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const newKey = { publicKey: key.publicKeyRaw, label };
  const signedFields = { op: 'keychain-register', namespace: identity.namespace, newKey, nonce, timestamp, identityHash: identity.identityHash };
  const signature = await identity.sign(normalizeProofMessage(signedFields));
  const res = await post(origin, '/api/v1/keychain/keys', { namespace: identity.namespace, identityHash: identity.identityHash, newKey, nonce, timestamp, signature });
  if (res.status !== 201) throw new Error(`Test setup failed: keychain register returned ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

async function bootstrapGateway(origin: string, identity: TestIdentity, keyId: string, key: DeviceKey) {
  const challenge = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'netget-claim-gateway', gatewayId: GATEWAY_ID, namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp };
  const signature = await key.sign(normalizeProofMessage(signedFields));
  return post(origin, `/api/v1/gateway/${GATEWAY_ID}/bootstrap`, { namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp, signature, username: identity.identityHash });
}

async function signedGrant(actingIdentity: TestIdentity, actingKeyId: string, actingKey: { sign(m: string): Promise<string> }, target: TestIdentity, scopes: string[]) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'gateway-grant-admin', gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, targetIdentityHash: target.identityHash, targetNamespace: target.namespace, targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp };
  const signature = await actingKey.sign(normalizeProofMessage(signedFields));
  return grantGatewayAdmin({ gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, actingKeyId, targetIdentityHash: target.identityHash, targetNamespace: target.namespace, targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp, signature });
}

async function signedRevoke(actingIdentity: TestIdentity, actingKeyId: string, actingKey: { sign(m: string): Promise<string> }, targetIdentityHash: string) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'gateway-revoke-admin', gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, targetIdentityHash, nonce, timestamp };
  const signature = await actingKey.sign(normalizeProofMessage(signedFields));
  return revokeGatewayAdmin({ gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, actingKeyId, targetIdentityHash, nonce, timestamp, signature });
}

const reservedPort = await reservePort();
const originGuard = installMonadOriginGuard([`http://127.0.0.1:${reservedPort}`]);

const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);

try {
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();
  assert.equal(rootNamespace, CLAIMED_NAMESPACE);

  // gatewayAdminActions.ts resolves the acting identity's surface via
  // topologyResolver.ts's resolveSurface() — same seeding pattern as
  // gateway-claims-live-write-integration.test.ts.
  {
    const registryDir = path.join(tmpDataDir, 'runtime');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      apps: {
        'test-surface': {
          id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0,
          lastSeenMs: Date.now(), ttlMs: 45_000, trust: 'owner',
          metadata: { namespace: rootNamespace, endpoint: origin },
          tags: [],
        },
      },
    }, null, 2), 'utf8');
  }

  const owner = await claimTestIdentity(origin, 'owner1', 'owner1-secret', rootNamespace);
  const ownerKey = await generateDeviceKey();
  const ownerKeyId = await registerFirstKeychainKey(origin, owner, ownerKey, "Owner's laptop");

  // Stands in for netget's own setup-code ceremony, bypassed here the same
  // way bootstrapGateway() itself bypasses the rest of that session.
  const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
  assert.ok(ownRecord, 'the disposable monad must have a real process record');
  const authIssued = issueInstallationAuthorization({
    stateDir: ownRecord!.stateDir,
    gatewayId: GATEWAY_ID,
    namespace: owner.namespace,
    identityHash: owner.identityHash,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  assert.ok(authIssued.ok, `installation authorization must be issuable: ${JSON.stringify(authIssued)}`);

  const bootstrapRes = await bootstrapGateway(origin, owner, ownerKeyId, ownerKey);
  assert.equal(bootstrapRes.status, 201, `bootstrap must succeed: ${JSON.stringify(bootstrapRes.json)}`);

  const mgr = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await mgr.materializeFromGatewayAuthority(origin);
  assert.equal(mgr.read()?.owner, owner.identityHash);

  // Grant a second, real admin identity with a real scope.
  const admin = await claimTestIdentity(origin, 'admin1', 'admin1-secret', rootNamespace);
  const adminKey = await generateDeviceKey();
  const adminKeyId = await registerFirstKeychainKey(origin, admin, adminKey, "Admin's laptop");
  const grantRes = await signedGrant(owner, ownerKeyId, ownerKey, admin, ['gateway:read']);
  assert.equal(grantRes.ok, true, `grant must succeed: ${(grantRes as any).message}`);
  assert.equal(mgr.read()?.admins[admin.identityHash], true, 'local cache reflects the new admin before opening a session');

  const claimsForSessions = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });

  // ── 1. Open a real admin session for the newly-granted admin, confirm
  // it genuinely works. ────────────────────────────────────────────────
  const challenge = issueAdminSessionChallenge(admin.identityHash, claimsForSessions);
  assert.equal(challenge.ok, true, `challenge must issue for a real admin: ${challenge.message}`);
  const challengeSignature = await adminKey.sign(challenge.challenge!);
  const verify = await verifyAdminSessionChallenge(admin.identityHash, admin.namespace, adminKeyId, challengeSignature, claimsForSessions);
  assert.equal(verify.ok, true, `session must verify against the real, active key: ${verify.message}`);
  const sessionToken = verify.sessionToken!;

  const resolvedBeforeRevoke = await resolveAdminSession(sessionToken, claimsForSessions);
  assert.ok(resolvedBeforeRevoke, 'the freshly-verified session must resolve');
  assert.deepEqual(resolvedBeforeRevoke!.scopes, ['gateway:read']);

  // ── 2. Owner revokes admin1's GATEWAY admin status (not the keychain
  // key — the key stays perfectly active throughout). ────────────────────
  const revokeRes = await signedRevoke(owner, ownerKeyId, ownerKey, admin.identityHash);
  assert.equal(revokeRes.ok, true, `revoke must succeed: ${(revokeRes as any).message}`);
  assert.equal(mgr.read()?.admins[admin.identityHash], undefined, 'local cache reflects the revocation');

  // ── 3. THE guarantee: the SAME session token's next resolve must be
  // rejected — this is a live, already-issued session dying from a
  // GATEWAY-side revoke, not a keychain-side one. ────────────────────────
  const resolvedAfterRevoke = await resolveAdminSession(sessionToken, claimsForSessions);
  assert.equal(resolvedAfterRevoke, null, 'a session for a since-revoked GATEWAY admin must stop resolving immediately, using the exact same token');

  // A brand-new challenge/verify attempt for the same (now-revoked)
  // identity must also be refused outright — not just resolution of an
  // old token.
  const challengeAfterRevoke = issueAdminSessionChallenge(admin.identityHash, claimsForSessions);
  assert.equal(challengeAfterRevoke.ok, false, 'a revoked gateway admin must not even be issued a fresh challenge');
  assert.equal(challengeAfterRevoke.message, 'NOT_AN_ADMIN');

  // ── 4. The identity that RETAINS authorization (the owner) must keep
  // working normally — revocation must not be collateral damage. ────────
  const ownerChallenge = issueAdminSessionChallenge(owner.identityHash, claimsForSessions);
  assert.equal(ownerChallenge.ok, true, `owner must still be able to open a session after admin1's revoke: ${ownerChallenge.message}`);
  const ownerSignature = await ownerKey.sign(ownerChallenge.challenge!);
  const ownerVerify = await verifyAdminSessionChallenge(owner.identityHash, owner.namespace, ownerKeyId, ownerSignature, claimsForSessions);
  assert.equal(ownerVerify.ok, true, `owner session must still verify: ${ownerVerify.message}`);
  const ownerResolved = await resolveAdminSession(ownerVerify.sessionToken!, claimsForSessions);
  assert.ok(ownerResolved, 'owner session must resolve normally, unaffected by admin1\'s revocation');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
}

console.log('gateway-admin-session-revocation ok');
