/**
 * gateway-setup-session-target-verification.test.ts — proves the specific
 * ordering guarantee the review required for installation authorization
 * (gatewaySetupSession.ts's verifyOwnMonadSurface()): if the namespace
 * resolves (via resolveSurface()/apps.json) to a surface that is NOT this
 * exact netget's own locally-managed monad process, commitSignedClaim must
 * refuse the whole recorrido — no installation authorization gets written
 * anywhere, and critically, NO HTTP bootstrap call is ever sent to that
 * other surface. Health-check-style queries (getMonadStatus against
 * netget's OWN record) are expected and fine; what must be exactly zero is
 * a POST to the wrong monad's own bootstrap endpoint.
 *
 * Two real, disposable monad processes throughout: "own" (the one netget
 * itself starts via startNetgetMonad — this is what verifyOwnMonadSurface()
 * must confirm the target IS) and "wrong" (a second, completely unrelated
 * disposable monad, started directly via monad.ai's own startMonadProcess,
 * standing in for a stale/incorrect/spoofed apps.json entry — or, in a real
 * deployment, a genuinely different host's monad). Never the real ambient
 * monad.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-target-verify-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const OWN_MONAD_NAME = `target-verify-own-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = OWN_MONAD_NAME;

const WRONG_MONAD_NAME = `target-verify-wrong-${process.pid}-${Date.now()}`;

const CLAIMED_NAMESPACE = `target-verify-owner-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = CLAIMED_NAMESPACE;

const GATEWAY_ID = 'target-verify-test.local';

const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { commitSignedClaim, createSetupSession, verifySetupCode, issueClaimChallenge } =
  await import('../src/modules/NetGetX/Auth/gatewaySetupSession.ts');
const { startMonadProcess, deleteMonadProcess, readInstallationAuthorization } = await import('monad.ai');
// Same reasoning as every other test file in this suite reaching this
// exact relative path: 'this.me' (published) lacks these newer primitives.
// @ts-expect-error -- no .d.ts resolution across this relative path.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } =
  await import('../../../../me/Typescript/dist/me.es.js');

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}
async function get(origin: string, urlPath: string) {
  const res = await fetch(`${origin}${urlPath}`);
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
  const claimRes = await post(origin, '/', { operation: 'claim', namespace, secret, identityHash, proof: { message: proofMessage, signature: proofSignature, publicKey: publicKeyRaw, timestamp } });
  if (claimRes.status !== 201) throw new Error(`Test setup failed: identity claim returned ${claimRes.status} ${JSON.stringify(claimRes.json)}`);
  return { namespace, identityHash, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

async function generateDeviceKey() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const { privateKey, publicKey } = await importEd25519SigningKey(seed);
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  return { publicKeyRaw, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

async function registerFirstKeychainKey(origin: string, identity: Awaited<ReturnType<typeof claimTestIdentity>>, key: Awaited<ReturnType<typeof generateDeviceKey>>, label: string) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const newKey = { publicKey: key.publicKeyRaw, label };
  const signedFields = { op: 'keychain-register', namespace: identity.namespace, newKey, nonce, timestamp, identityHash: identity.identityHash };
  const signature = await identity.sign(normalizeProofMessage(signedFields));
  const res = await post(origin, '/api/v1/keychain/keys', { namespace: identity.namespace, identityHash: identity.identityHash, newKey, nonce, timestamp, signature });
  if (res.status !== 201) throw new Error(`Test setup failed: keychain register returned ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

const ownPort = await reservePort();
const wrongPort = await reservePort();
const guard = installMonadOriginGuard([`http://127.0.0.1:${ownPort}`, `http://127.0.0.1:${wrongPort}`]);

const ownStatus = await startNetgetMonad({ port: ownPort });
assert.ok(ownStatus.running, `own disposable monad must actually start: ${ownStatus.message}`);

const wrongStatus = await startMonadProcess({
  name: WRONG_MONAD_NAME,
  port: wrongPort,
  namespace: CLAIMED_NAMESPACE,
  seed: `target-verify-wrong-seed-${Date.now()}`,
});
assert.ok(wrongStatus.pidAlive, 'the WRONG disposable monad (standing in for a stale/incorrect surface) must actually start');

try {
  const rootNamespace = getGatewayRootNamespace();
  assert.equal(rootNamespace, CLAIMED_NAMESPACE);

  // The mesh registry's own entry for this namespace resolves to the
  // WRONG monad's origin -- exactly the scenario a stale apps.json entry,
  // a misconfigured surface, or (in a real deployment) code execution
  // spoofing the registry would produce.
  const registryDir = path.join(tmpDataDir, 'runtime');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    apps: {
      'wrong-surface': {
        id: 'wrong-surface', name: 'wrong-surface', host: '127.0.0.1', port: 0,
        lastSeenMs: Date.now(), ttlMs: 45_000, trust: 'owner',
        metadata: { namespace: rootNamespace, endpoint: wrongStatus.record.endpoint },
        tags: [],
      },
    },
  }, null, 2), 'utf8');

  // A genuinely valid identity + active key -- but claimed and registered
  // on the WRONG monad, since that's the surface resolveSurface() will
  // hand back for this namespace. Every check BEFORE verifyOwnMonadSurface()
  // (fetchKeychainKey, identity match, signature) must legitimately pass
  // here, so what actually stops this is specifically the target-
  // verification step, not an earlier, unrelated rejection.
  const alice = await claimTestIdentity(wrongStatus.record.endpoint, 'alice', 'alice-secret', rootNamespace);
  const aliceKey = await generateDeviceKey();
  const aliceKeyId = await registerFirstKeychainKey(wrongStatus.record.endpoint, alice, aliceKey, "Alice's laptop");

  const session = createSetupSession(GATEWAY_ID);
  const verify = verifySetupCode(session.code);
  assert.ok(verify.ok, 'setup code must verify');
  const challengeResult = issueClaimChallenge((verify as any).setupToken, 'https://example.test', '/netget');
  assert.ok(challengeResult.ok, 'challenge must be issued');
  const { challenge, state } = challengeResult as any;

  const signedFields = { op: 'netget-claim-gateway', gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash, keyId: aliceKeyId, challenge, timestamp: Date.now() };
  const signature = await aliceKey.sign(normalizeProofMessage(signedFields));

  const result = await commitSignedClaim((verify as any).setupToken, {
    namespace: alice.namespace, identityHash: alice.identityHash, keyId: aliceKeyId,
    signature, timestamp: signedFields.timestamp, state,
  });

  assert.equal(result.ok, false, 'a claim resolving to a surface that is not this netget\'s own monad must be refused');
  assert.match((result as any).message, /verify the target surface/i);

  // The actual proof this closes the gap: the WRONG monad's own gateway
  // authority record was NEVER created -- meaning no bootstrap POST, and
  // no installation-authorization write, ever reached it. A health check
  // against netget's OWN record is expected and fine; what must be exactly
  // zero is a request that could have forged an owner on the wrong host.
  const wrongRead = await get(wrongStatus.record.endpoint, `/api/v1/gateway/${GATEWAY_ID}/authority`);
  assert.equal(wrongRead.json.record, null, 'the wrong monad must never have been bootstrapped');
  assert.equal(
    readInstallationAuthorization(wrongStatus.record.stateDir, GATEWAY_ID), null,
    'no installation authorization must ever have been written into the wrong monad\'s own stateDir',
  );
} finally {
  guard.uninstall();
  await deleteMonadProcess(OWN_MONAD_NAME).catch(() => {});
  await deleteMonadProcess(WRONG_MONAD_NAME).catch(() => {});
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
}

console.log('gateway-setup-session-target-verification ok');
