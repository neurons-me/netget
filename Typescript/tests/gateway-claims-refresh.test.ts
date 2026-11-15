/**
 * gateway-claims-refresh.test.ts -- the deploy kit's checked rebuild of gateway-claims.json (gatewayClaimsRefresh.ts),
 * against a real, disposable monad holding real gateway authority (bootstrapped through the signed path).
 *
 *   1. A pre-upgrade cache (no `namespaces`) authorizes no admin session.
 *   2. The refresh, from the configured monad, writes the binding; the legitimate owner then gets a session, and a
 *      legitimately linked second namespace of the SAME identity is still refused (not anchored).
 *   3. What the refresh refuses, leaving the file byte-for-byte unchanged: an unreachable origin, an owner different
 *      from the cached one (unless accepted), a non-loopback origin.
 *   4. With no explicit origin it uses the running netget monad's own record, and starts nothing.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';
import { meDistUrl } from './_meDist.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-claims-refresh-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
delete process.env.NETGET_MONAD_ORIGIN;

const TEST_MONAD_NAME = `claims-refresh-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;
const CLAIMED_NAMESPACE = `claims-refresh-root-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = CLAIMED_NAMESPACE;
const GATEWAY_ID = 'claims-refresh-test.local';

const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager, getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { resolveGatewayAuthorityOrigin, refreshGatewayClaims } = await import('../src/modules/NetGetX/Auth/gatewayClaimsRefresh.ts');
const { issueAdminSessionChallenge, verifyAdminSessionChallenge, resolveAdminSession } = await import('../src/modules/NetGetX/Auth/adminSession.ts');
const { deleteMonadProcess, issueInstallationAuthorization, readMonadRecord } = await import('monad.ai');
// @ts-expect-error -- no .d.ts resolution across this relative path.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } = await import(meDistUrl());

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


const reservedPort = await reservePort();
const deadPort = await reservePort();
const originGuard = installMonadOriginGuard([`http://127.0.0.1:${reservedPort}`, `http://127.0.0.1:${deadPort}`]);
const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);

try {
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();
  {
    const registryDir = path.join(tmpDataDir, 'runtime');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify({
      version: 1, updatedAt: new Date().toISOString(),
      apps: { 'test-surface': { id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0, lastSeenMs: Date.now(), ttlMs: 45_000, trust: 'owner', metadata: { namespace: rootNamespace, endpoint: origin }, tags: [] } },
    }, null, 2), 'utf8');
  }

  const owner = await claimTestIdentity(origin, 'owner1', 'owner1-secret', rootNamespace);
  const ownerKey = await generateDeviceKey();
  const ownerKeyId = await registerFirstKeychainKey(origin, owner, ownerKey, "Owner's laptop");
  const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
  assert.ok(ownRecord);
  assert.ok(issueInstallationAuthorization({ stateDir: ownRecord!.stateDir, gatewayId: GATEWAY_ID, namespace: owner.namespace, identityHash: owner.identityHash, expiresAt: Date.now() + 600_000 }).ok);
  const boot = await bootstrapGateway(origin, owner, ownerKeyId, ownerKey);
  assert.equal(boot.status, 201, JSON.stringify(boot.json));

  // ── 1. the pre-upgrade cache: same owner/admins, no `namespaces` ──
  const claimsPath = getGatewayClaimsPath();
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  fs.writeFileSync(claimsPath, JSON.stringify({
    gatewayId: GATEWAY_ID, owner: owner.identityHash, admins: { [owner.identityHash]: true },
    grants: { [owner.identityHash]: ['gateway:read'] }, pubkeys: {}, usernames: {}, version: 'pre-upgrade', updatedAt: 1,
  }, null, 2));
  const signIn = async (namespace: string, keyId: string, key: { sign(m: string): Promise<string> }) => {
    const c = issueAdminSessionChallenge(owner.identityHash);
    assert.ok(c.ok, c.message);
    return verifyAdminSessionChallenge(owner.identityHash, namespace, keyId, await key.sign(c.challenge!));
  };
  assert.equal((await signIn(owner.namespace, ownerKeyId, ownerKey)).message, 'GATEWAY_BINDING_MISSING', 'pre-upgrade cache: no session');

  // ── 3a. refusals leave the file byte-for-byte unchanged ──
  const before = fs.readFileSync(claimsPath, 'utf8');
  assert.deepEqual(await refreshGatewayClaims(`http://127.0.0.1:${deadPort}`), { ok: false, error: 'AUTHORITY_UNCONFIRMED' });
  assert.equal(fs.readFileSync(claimsPath, 'utf8'), before, 'an unreachable origin changes nothing');
  fs.writeFileSync(claimsPath, before.replace(`"owner": "${owner.identityHash}"`, '"owner": "someone-else"'));
  const ownerChangedBytes = fs.readFileSync(claimsPath, 'utf8');
  assert.deepEqual(await refreshGatewayClaims(origin), { ok: false, error: 'OWNER_CHANGED' });
  assert.equal(fs.readFileSync(claimsPath, 'utf8'), ownerChangedBytes, 'an owner change is refused unless accepted, and changes nothing');
  await assert.rejects(() => resolveGatewayAuthorityOrigin('http://10.1.2.3:7777'), /loopback only/);
  fs.writeFileSync(claimsPath, before);

  // ── 4. no explicit origin: the running netget monad's own record ──
  assert.equal(await resolveGatewayAuthorityOrigin(), new URL(origin).origin);

  // ── 2. the refresh writes the binding; the owner signs in; a non-anchored namespace does not ──
  const refreshed = await refreshGatewayClaims(await resolveGatewayAuthorityOrigin());
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  const snapshot = new GatewayClaimsManager(GATEWAY_ID, { ledger: false }).read()!;
  assert.equal(snapshot.namespaces?.[owner.identityHash], owner.namespace);
  const ownerSession = await signIn(owner.namespace, ownerKeyId, ownerKey);
  assert.equal(ownerSession.ok, true, JSON.stringify(ownerSession));
  assert.ok(await resolveAdminSession(ownerSession.sessionToken!), 'the owner session resolves');

  const handle = 'owner1-two';
  const secondNamespace = `${handle}.${rootNamespace}`;
  const { privateKey, publicKey } = await importEd25519SigningKey(await deriveBranchProofSeed('owner1-two-secret', handle));
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  const timestamp = Date.now();
  const message = normalizeProofMessage({ identityHash: owner.identityHash, expression: handle, namespace: secondNamespace, rootNamespace, challenge: null, timestamp });
  const linkSignature = await owner.sign(normalizeProofMessage({ op: 'identity-link', identityHash: owner.identityHash, fromNamespace: owner.namespace, toNamespace: secondNamespace, toPublicKey: publicKeyRaw, timestamp }));
  const second = await post(origin, '/', {
    operation: 'claim', namespace: secondNamespace, identityHash: owner.identityHash,
    proof: { message, signature: await signEd25519Proof(privateKey, message), publicKey: publicKeyRaw, timestamp },
    link: { fromNamespace: owner.namespace, timestamp, signature: linkSignature },
  });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  const secondKey = await generateDeviceKey();
  const secondKeyId = await registerFirstKeychainKey(origin, { namespace: secondNamespace, identityHash: owner.identityHash, sign: (m: string) => signEd25519Proof(privateKey, m) }, secondKey, 'second');
  assert.equal((await signIn(secondNamespace, secondKeyId, secondKey)).message, 'NAMESPACE_NOT_ANCHORED', 'the same identity on a non-anchored namespace stays refused');

  // ── 3b. an accepted owner change goes through (and is reported) ──
  fs.writeFileSync(claimsPath, fs.readFileSync(claimsPath, 'utf8').replace(`"owner": "${owner.identityHash}"`, '"owner": "someone-else"'));
  const accepted = await refreshGatewayClaims(origin, { acceptOwnerChange: true });
  assert.equal(accepted.ok, true);
  assert.equal(new GatewayClaimsManager(GATEWAY_ID, { ledger: false }).read()?.owner, owner.identityHash);

  console.log('gateway-claims-refresh ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
