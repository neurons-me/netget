/**
 * gateway-claims-live-write-integration.test.ts — proves netget's own
 * forwarding/materializing layer (`gatewayAdminActions.ts` +
 * `GatewayClaimsManager.materializeFromGatewayAuthority`) actually works
 * end to end against a real, disposable monad that holds a genuine `.me`
 * claim for the gateway's own namespace.
 *
 * HISTORY / WHY THIS FILE'S SHAPE CHANGED
 * This file originally proved the OLD model was broken: `GatewayClaimsManager
 * .grantAdmin()` wrote through an UNSIGNED `writeToMonad()` call, which a
 * monad holding a real `.me` claim correctly rejected with
 * `NAMESPACE_WRITE_FORBIDDEN` (`commandHandler.ts`'s `isNamespaceWriteAuthorized()`
 * gate). That confirmed gap is what motivated the E+A signed-delegation
 * mechanism (`modules/monad/Typescript/src/claim/gatewayAuthority.ts` +
 * this module's own `gatewayAdminActions.ts`). This file now proves the
 * FIX actually works over real HTTP, not just in `gatewayAuthority.test.ts`'s
 * own monad-side unit coverage or `gateway-setup-session.test.ts`'s own
 * bootstrap-focused coverage — this is the netget-side forwarding layer's
 * own integration proof.
 *
 * Real disposable monad throughout (reservePort + installMonadOriginGuard +
 * startNetgetMonad), never the real ambient one.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gwclaims-live-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const TEST_MONAD_NAME = `gwclaims-live-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

// Matches the real deployed shape (see netget-gateway-harness-server.mjs):
// NETGET_MONAD_NAMESPACE is pointed directly at the operator's own claimed
// namespace, so getGatewayRootNamespace() resolves to a namespace that
// genuinely holds a real .me claim, not an arbitrary unclaimed string.
const CLAIMED_NAMESPACE = `gwclaims-owner-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = CLAIMED_NAMESPACE;

const GATEWAY_ID = 'gwclaims-live-test.local';

const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { grantGatewayAdmin, revokeGatewayAdmin, transferGatewayOwner } =
  await import('../src/modules/NetGetX/Auth/gatewayAdminActions.ts');
const { deleteMonadProcess } = await import('monad.ai');
// Same reasoning as admin-session-live-keychain.test.ts's identical import:
// 'this.me' (published) lacks these newer primitives; reach the local
// workspace build directly.
// @ts-expect-error -- no .d.ts resolution across this relative path.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } =
  await import('../../../../me/Typescript/dist/me.es.js');

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
    operation: 'claim',
    namespace,
    secret,
    identityHash,
    proof: { message: proofMessage, signature: proofSignature, publicKey: publicKeyRaw, timestamp },
  });
  if (claimRes.status !== 201) {
    throw new Error(`Test setup failed: identity claim returned ${claimRes.status} ${JSON.stringify(claimRes.json)}`);
  }
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
  const res = await post(origin, '/api/v1/keychain/keys', {
    namespace: identity.namespace, identityHash: identity.identityHash, newKey, nonce, timestamp, signature,
  });
  if (res.status !== 201) throw new Error(`Test setup failed: keychain register returned ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

// Bootstraps the canonical gateway-authority branch directly (mirrors what
// gatewaySetupSession.ts's commitSignedClaim does, minus its own session/
// challenge ceremony, which is already covered end to end by
// gateway-setup-session.test.ts) — this file's own focus is the grant/
// revoke/transfer forwarding layer, not bootstrap itself.
async function bootstrapGateway(origin: string, identity: TestIdentity, keyId: string, key: DeviceKey) {
  const challenge = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'netget-claim-gateway', gatewayId: GATEWAY_ID, namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp };
  const signature = await key.sign(normalizeProofMessage(signedFields));
  return post(origin, `/api/v1/gateway/${GATEWAY_ID}/bootstrap`, {
    namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp, signature, username: identity.identityHash,
  });
}

const reservedPort = await reservePort();
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
const originGuard = installMonadOriginGuard([expectedOrigin]);

const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);

try {
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();
  assert.equal(rootNamespace, CLAIMED_NAMESPACE, 'NETGET_MONAD_NAMESPACE override must be in effect');

  // gatewayAdminActions.ts (unlike the OLD writeToMonad()-based methods it
  // replaces) resolves the acting identity's surface via
  // topologyResolver.ts's resolveSurface() -- the same mesh registry
  // gatewaySetupSession.ts's own commitSignedClaim already depends on. Seed
  // ONE entry for rootNamespace; every compound identity below
  // (<handle>.rootNamespace) resolves to it via resolveSurface's own
  // rootspaceOf() reduction, exactly like gateway-setup-session.test.ts's
  // identical seeding.
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

  // Real claim + real keychain key -- the disposable monad now genuinely
  // has getClaim(<identity's own namespace>) truthy AND a live keychain,
  // the exact preconditions claim/gatewayAuthority.ts's own checks
  // require. Each identity below claims its OWN compound namespace
  // (<handle>.rootNamespace), not the bare rootNamespace itself -- first-
  // claim-wins would otherwise let only the first of them succeed.
  const owner = await claimTestIdentity(origin, 'owner1', 'owner1-secret', rootNamespace);
  const ownerKey = await generateDeviceKey();
  const ownerKeyId = await registerFirstKeychainKey(origin, owner, ownerKey, "Owner's laptop");

  const bootstrapRes = await bootstrapGateway(origin, owner, ownerKeyId, ownerKey);
  assert.equal(bootstrapRes.status, 201, `bootstrap must succeed: ${JSON.stringify(bootstrapRes.json)}`);

  const mgr = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await mgr.materializeFromGatewayAuthority(origin);
  assert.equal(mgr.read()?.owner, owner.identityHash, 'local snapshot bound to the real claimed owner');

  // THE fix this file proves: a real signed grant, forwarded by netget's
  // own gatewayAdminActions.ts, actually succeeds against this now-claimed
  // monad -- unlike the old unsigned writeToMonad() path this file used to
  // catch failing. Each helper below builds the real signature over the
  // exact fields gatewayAdminActions.ts forwards, the same way the (not
  // yet built) GUI client would.
  const admin = await claimTestIdentity(origin, 'admin1', 'admin1-secret', rootNamespace);

  async function signedGrant(actingIdentity: TestIdentity, actingKeyId: string, actingKey: DeviceKey, target: TestIdentity, scopes: string[]) {
    const nonce = crypto.randomBytes(16).toString('base64url');
    const timestamp = Date.now();
    const signedFields = {
      op: 'gateway-grant-admin', gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace,
      targetIdentityHash: target.identityHash, targetNamespace: target.namespace,
      targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp,
    };
    const signature = await actingKey.sign(normalizeProofMessage(signedFields));
    return grantGatewayAdmin({
      gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, actingKeyId,
      targetIdentityHash: target.identityHash, targetNamespace: target.namespace,
      targetPublicKey: null, targetUsername: null, scopes, nonce, timestamp, signature,
    });
  }

  async function signedRevoke(actingIdentity: TestIdentity, actingKeyId: string, actingKey: DeviceKey, targetIdentityHash: string) {
    const nonce = crypto.randomBytes(16).toString('base64url');
    const timestamp = Date.now();
    const signedFields = { op: 'gateway-revoke-admin', gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, targetIdentityHash, nonce, timestamp };
    const signature = await actingKey.sign(normalizeProofMessage(signedFields));
    return revokeGatewayAdmin({ gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, actingKeyId, targetIdentityHash, nonce, timestamp, signature });
  }

  async function signedTransfer(actingIdentity: TestIdentity, actingKeyId: string, actingKey: DeviceKey, targetIdentityHash: string) {
    const nonce = crypto.randomBytes(16).toString('base64url');
    const timestamp = Date.now();
    const signedFields = { op: 'gateway-transfer-owner', gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, targetIdentityHash, nonce, timestamp };
    const signature = await actingKey.sign(normalizeProofMessage(signedFields));
    return transferGatewayOwner({ gatewayId: GATEWAY_ID, namespace: actingIdentity.namespace, actingKeyId, targetIdentityHash, nonce, timestamp, signature });
  }

  const realGrant = await signedGrant(owner, ownerKeyId, ownerKey, admin, ['apps:read']);
  assert.equal(realGrant.ok, true, `grantGatewayAdmin must succeed against a real claimed monad: ${(realGrant as any).message}`);
  assert.equal(mgr.read()?.admins[admin.identityHash], true, 'local cache reflects the new admin after a successful grant');
  assert.deepEqual(mgr.read()?.grants[admin.identityHash], ['apps:read']);

  // Adversarial case: a genuinely different, validly-keyed identity that
  // holds NO gateway authority must be rejected -- "a valid signature from
  // an active key doesn't grant gateway authority by itself."
  const stranger = await claimTestIdentity(origin, 'stranger1', 'stranger1-secret', rootNamespace);
  const strangerKey = await generateDeviceKey();
  const strangerKeyId = await registerFirstKeychainKey(origin, stranger, strangerKey, "Stranger's laptop");
  const unauthorizedGrant = await signedGrant(stranger, strangerKeyId, strangerKey, admin, ['domains:read']);
  assert.equal(unauthorizedGrant.ok, false, 'an identity with no gateway authority must not be able to grant');
  assert.equal((unauthorizedGrant as any).message, 'PERMISSION_DENIED');

  // Revoke, by the real owner.
  const realRevoke = await signedRevoke(owner, ownerKeyId, ownerKey, admin.identityHash);
  assert.equal(realRevoke.ok, true, `revokeGatewayAdmin must succeed: ${(realRevoke as any).message}`);
  assert.equal(mgr.read()?.admins[admin.identityHash], undefined, 'local cache reflects the revocation');

  // Transfer requires the ACTING identity to be owner -- re-grant admin1
  // first (revoked above), then transfer to them, then confirm the
  // now-former-owner can no longer transfer again.
  await signedGrant(owner, ownerKeyId, ownerKey, admin, ['gateway:read']);
  const adminKey = await generateDeviceKey();
  const adminKeyId = await registerFirstKeychainKey(origin, admin, adminKey, "Admin's laptop");
  const nonOwnerTransfer = await signedTransfer(admin, adminKeyId, adminKey, admin.identityHash);
  assert.equal(nonOwnerTransfer.ok, false, 'a non-owner admin must not be able to transfer ownership');
  assert.equal((nonOwnerTransfer as any).message, 'OWNER_ONLY');

  const realTransfer = await signedTransfer(owner, ownerKeyId, ownerKey, admin.identityHash);
  assert.equal(realTransfer.ok, true, `transferGatewayOwner must succeed: ${(realTransfer as any).message}`);
  assert.equal(mgr.read()?.owner, admin.identityHash, 'local cache reflects the transfer');

  // Restart: a FRESH manager instance re-materializing from the canonical
  // branch shows the SAME confirmed state, never re-enabling a fresh
  // bootstrap.
  const afterRestart = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await afterRestart.materializeFromGatewayAuthority(origin);
  assert.equal(afterRestart.read()?.owner, admin.identityHash, 'owner survives a fresh manager instance ("restart") unchanged');

  const staleBootstrapAttempt = await bootstrapGateway(origin, owner, ownerKeyId, ownerKey);
  assert.equal(staleBootstrapAttempt.status, 409, 'the former owner can no longer re-bootstrap after a real transfer');
  assert.equal(staleBootstrapAttempt.json.error, 'ALREADY_BOOTSTRAPPED');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
}

console.log('gateway-claims-live-write-integration ok');
