/**
 * admin-session-live-keychain.test.ts — proves adminSession.ts actually
 * consults the LIVE keychain, not a snapshot frozen at claim time. A
 * first version of adminSession.ts verified against
 * GatewayClaimsManager's own `pubkeys[identityHash]` — set once, at
 * claim/grantAdmin time, never updated by a later key rotation. That
 * would keep accepting a since-revoked key, and would refuse a
 * genuinely-active NEW one. This file is the reviewer-requested proof
 * that the fix (fetchKeychainKey, re-checked on every verify AND on
 * every session resolve) actually behaves that way:
 *
 *   key A valid -> revoke A -> A rejected -> key B (rotated to) accepted,
 *   owner unchanged throughout -- and a session A already MINTED before
 *   its own revocation stops working on its very next use, not only once
 *   its 30-minute TTL would have ended it anyway.
 *
 * Real keychain HTTP calls throughout (claim/register/revoke), same
 * helpers and same real Ed25519 primitives as
 * gateway-setup-session.test.ts's own case 7 -- against a genuinely
 * isolated, disposable monad this file starts and deletes itself, never
 * the real 'netget' one. gateway-claims.json is hand-written (owner,
 * admin, scope) -- this file is testing adminSession.ts's OWN
 * verification, not netget's separate claim-commit flow (already
 * covered end to end in gateway-setup-session.test.ts).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-admin-session-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const TEST_MONAD_NAME = `admin-session-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { issueAdminSessionChallenge, verifyAdminSessionChallenge, resolveAdminSession } =
  await import('../src/modules/NetGetX/Auth/adminSession.ts');
const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager, getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { readMonadRecord, deleteMonadProcess } = await import('monad.ai');
// Same reasoning as gateway-setup-session.test.ts's identical import:
// 'this.me' (published) lacks these newer primitives; reach the local
// workspace build directly, same as modules/monad's own
// keychainMinimalWalkthrough.test.ts does.
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

function randomNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
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
  const seed = crypto.randomBytes(32);
  const { privateKey, publicKey } = await importEd25519SigningKey(new Uint8Array(seed));
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  return { publicKeyRaw, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

type TestIdentity = Awaited<ReturnType<typeof claimTestIdentity>>;
type DeviceKey = Awaited<ReturnType<typeof generateDeviceKey>>;

async function registerFirstKeychainKey(origin: string, identity: TestIdentity, deviceKey: DeviceKey, label: string) {
  const nonce = randomNonce();
  const timestamp = Date.now();
  const newKey = { publicKey: deviceKey.publicKeyRaw, label };
  const signedFields = { op: 'keychain-register', namespace: identity.namespace, newKey, nonce, timestamp, identityHash: identity.identityHash };
  const signature = await identity.sign(normalizeProofMessage(signedFields));
  const res = await post(origin, '/api/v1/keychain/keys', {
    namespace: identity.namespace, identityHash: identity.identityHash, newKey, nonce, timestamp, signature,
  });
  if (res.status !== 201) throw new Error(`Test setup failed: bootstrap keychain register returned ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

async function registerKeychainKeyViaActing(
  origin: string, namespace: string, actingKeyId: string, actingSigner: { sign(message: string): Promise<string> },
  deviceKey: DeviceKey, label: string, admin = false,
) {
  const nonce = randomNonce();
  const timestamp = Date.now();
  const newKey = { publicKey: deviceKey.publicKeyRaw, label, admin };
  const signedFields = { op: 'keychain-register', namespace, newKey, nonce, timestamp, actingKeyId };
  const signature = await actingSigner.sign(normalizeProofMessage(signedFields));
  const res = await post(origin, '/api/v1/keychain/keys', { namespace, actingKeyId, newKey, nonce, timestamp, signature });
  if (res.status !== 201) throw new Error(`Test setup failed: peer-signed keychain register returned ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

async function revokeKeychainKey(
  origin: string, namespace: string, actingKeyId: string, actingSigner: { sign(message: string): Promise<string> }, targetKeyId: string,
) {
  const nonce = randomNonce();
  const timestamp = Date.now();
  const signedFields = { op: 'keychain-revoke', namespace, actingKeyId, targetKeyId, nonce, timestamp };
  const signature = await actingSigner.sign(normalizeProofMessage(signedFields));
  const res = await post(origin, `/api/v1/keychain/keys/${targetKeyId}/revoke`, { namespace, actingKeyId, nonce, timestamp, signature });
  if (res.status !== 200) throw new Error(`Test setup failed: keychain revoke returned ${res.status} ${JSON.stringify(res.json)}`);
}

const reservedPort = await reservePort();
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
const originGuard = installMonadOriginGuard([expectedOrigin]);

const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);
const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
assert.ok(ownRecord, 'the disposable monad must be registered under its own unique name');
assert.equal(ownRecord!.port, reservedPort);
const realRecord = await readMonadRecord('netget').catch(() => null);
if (realRecord) {
  assert.notEqual(ownRecord!.port, realRecord.port, 'must never resolve to the real ambient "netget" monad\'s port');
}

try {
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();

  // adminSession.ts now resolves namespace -> monad via topologyResolver.ts's
  // resolveSurface() (same mechanism gateway-setup-session.test.ts's case 7
  // seeds) -- one entry for this test's own rootNamespace covers
  // alice.<rootNamespace> via resolveSurface's rootspaceOf() reduction.
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

  const alice = await claimTestIdentity(origin, 'alice', 'alice-secret', rootNamespace);
  const keyA = await generateDeviceKey();
  const keyAId = await registerFirstKeychainKey(origin, alice, keyA, 'Alice\'s laptop (key A)');

  // Netget-side admin grant, hand-written -- this file tests
  // adminSession.ts's OWN verification, not gatewaySetupSession.ts's
  // separate claim-commit flow (covered elsewhere). Owner == alice from
  // the start; re-checked unchanged at the very end.
  const claimsPath = getGatewayClaimsPath();
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  fs.writeFileSync(claimsPath, JSON.stringify({
    gatewayId: 'admin-session-test.local',
    owner: alice.identityHash,
    admins: { [alice.identityHash]: true },
    grants: { [alice.identityHash]: ['gateway:read'] },
    pubkeys: {},
    usernames: { [alice.identityHash]: 'alice' },
  }, null, 2), 'utf8');

  // ── 1. Key A, valid: challenge -> real signature -> session works ──────
  const challengeA = issueAdminSessionChallenge(alice.identityHash);
  assert.ok(challengeA.ok && challengeA.challenge, 'a real admin must receive a challenge');
  const sigA = await keyA.sign(challengeA.challenge!);
  const verifyA = await verifyAdminSessionChallenge(alice.identityHash, alice.namespace, keyAId, sigA);
  assert.equal(verifyA.ok, true, JSON.stringify(verifyA));
  const tokenA = verifyA.sessionToken!;

  const resolvedA = await resolveAdminSession(tokenA);
  assert.ok(resolvedA, 'a session minted from a genuinely active key must resolve');
  assert.deepEqual(resolvedA!.scopes, ['gateway:read']);

  // ── 2. Rotate: register B (acting=A), then revoke A (acting=B) ─────────
  const keyB = await generateDeviceKey();
  const keyBId = await registerKeychainKeyViaActing(origin, alice.namespace, keyAId, keyA, keyB, 'Alice\'s new phone (key B)', true);
  await revokeKeychainKey(origin, alice.namespace, keyBId, keyB, keyAId);

  // ── 3. A's OWN already-issued session must die on its very next use —
  // BEFORE its 30-minute TTL would have ended it, because the key that
  // signed it no longer checks out live. This is the answer to "what
  // happens to sessions issued before a revocation": they stop working
  // immediately, not at their own expiry.
  const resolvedAfterRevoke = await resolveAdminSession(tokenA);
  assert.equal(resolvedAfterRevoke, null, 'a session signed by a since-revoked key must stop resolving immediately, not at its own TTL');

  // ── 4. A can no longer even mint a NEW session -- a fresh challenge,
  // signed with the now-revoked A, must be rejected outright.
  const challengeA2 = issueAdminSessionChallenge(alice.identityHash);
  const sigA2 = await keyA.sign(challengeA2.challenge!);
  const verifyA2 = await verifyAdminSessionChallenge(alice.identityHash, alice.namespace, keyAId, sigA2);
  assert.equal(verifyA2.ok, false);
  assert.equal(verifyA2.message, 'KEY_REVOKED');

  // ── 5. B, the key actually rotated to, works -- both for a fresh
  // challenge AND (implicitly, since resolveAdminSession also re-fetches
  // live) for ongoing use.
  const challengeB = issueAdminSessionChallenge(alice.identityHash);
  const sigB = await keyB.sign(challengeB.challenge!);
  const verifyB = await verifyAdminSessionChallenge(alice.identityHash, alice.namespace, keyBId, sigB);
  assert.equal(verifyB.ok, true, JSON.stringify(verifyB));
  const resolvedB = await resolveAdminSession(verifyB.sessionToken!);
  assert.ok(resolvedB, 'a session minted from the newly-active key B must resolve');
  assert.equal(resolvedB!.identityHash, alice.identityHash);

  // ── 6. Owner unchanged throughout the entire rotation. ──────────────────
  const finalClaims = new GatewayClaimsManager().read();
  assert.equal(finalClaims?.owner, alice.identityHash, 'owner must never change just from rotating which key signs for the same identity');

  console.log('admin-session-live-keychain ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
