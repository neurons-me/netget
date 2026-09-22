/**
 * Proves gatewaySetupSession.ts's own guarantees — the shared service both
 * `netget init`/`netget claim` (in-process) and the browser's /setup/*
 * routes call. Each case maps directly to one of the guarantees this
 * feature was built for (see the approved plan / this module's own
 * header comment):
 *
 *   - Random, temporary code with limited attempts, never retrievable in
 *     plaintext once issued.
 *   - Session + challenge bound to this gateway and to the claim
 *     operation — a signed message built against any OTHER challenge is
 *     rejected before any ledger/ownership check even runs.
 *   - The signing key is the claimant's REAL Cleaker keychain key, never a
 *     fresh identity derived from a username/password — and the server
 *     verifies the ACTUAL key record it fetches from that keychain, never
 *     a client-supplied public key or authorization status.
 *   - An active key only proves it belongs to `namespace`'s keychain — the
 *     server separately confirms `namespace`'s own claim resolves to the
 *     asserted `identityHash` before ever trusting it as the new owner
 *     (otherwise anyone with their own valid key could assert someone
 *     else's identity as owner).
 *   - A revoked key can no longer sign a claim, even one otherwise
 *     identical to a previously-valid one.
 *   - Namespace surface resolution is a REAL gate, not skippable: a
 *     well-formed claim attempt refuses to even look up the signing key
 *     while no live surface is registered for the claimed namespace
 *     (topologyResolver.ts's resolveSurface(), reading the same apps.json
 *     mesh registry a real reported app would populate).
 *   - The full success path (atomic lock, signed bootstrap forwarded to and
 *     independently re-verified by the target monad's own
 *     claim/gatewayAuthority.ts, persisted-check, session consumption,
 *     replay rejection, rebind rejection for a different identity, and — a
 *     deliberate strengthening over the OLD local-only model — a local
 *     cache wipe does NOT unbind the canonical owner) — against a
 *     genuinely isolated, disposable monad this file starts and tears down
 *     itself, NEVER the real 'netget'-named one.
 *
 * NETGET_MONAD_NAME is set before any import, for every case in this
 * file, not only the one that starts a monad — nothing here must even be
 * ABLE to resolve to a real ambient monad process. This isn't defensive
 * paranoia: an earlier version of this file's success-path case, without
 * this override, wrote a throwaway test identity straight into whatever
 * REAL monad happened to be running on the machine executing the test —
 * silently corrupting a real gateway's real ledger (netget.owner.*, plus
 * four bogus admin/grant/pubkey/username entries), because nothing
 * scoped which monad process the name "netget" resolved to. NETGET_DATA_DIR
 * only ever scoped netget's OWN local files (gateway-claims.json,
 * setup-session.json) — never monad.ai's own process registry or the
 * ledger a running monad actually serves. See netgetMonadProcess.ts's
 * getMonadName() for the fix this incident produced.
 *
 * Signing reuses this.me's real Ed25519 primitives — the same ones
 * SeedSession.signPayload() wraps for a BIP-39-recovered identity, and
 * the same ones modules/monad's keychainMinimalWalkthrough.test.ts already
 * uses to represent a claimed identity's keychain end to end. A namespace's
 * claim (established via `POST /` with `operation: 'claim'`) is the sole
 * authority for that namespace's FIRST keychain key — exactly the real
 * "connect your Cleaker identity, pick an active key" path this feature
 * reconnects to, never a fresh identity minted from a password.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-setup-session-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const TEST_MONAD_NAME = `netget-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { createSetupSession, verifySetupCode, issueClaimChallenge, commitSignedClaim } =
  await import('../src/modules/NetGetX/Auth/gatewaySetupSession.ts');
const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager, getGatewayClaimsPath, getGatewayClaimsVersionPath } =
  await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { deleteMonadProcess } = await import('monad.ai');
// 'this.me' (the package name) resolves to the last PUBLISHED npm release,
// which lacks the newer deriveBranchProofSeed/importEd25519SigningKey/
// signEd25519Proof primitives this file needs to stand up a real,
// recoverable test identity + device keys — reaching the live workspace
// build directly instead, same as modules/monad's own
// keychainMinimalWalkthrough.test.ts does for the identical reason.
// @ts-expect-error -- no .d.ts resolution across this relative path; the
// runtime import reaches the local workspace build directly.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } =
  await import('../../../../me/Typescript/dist/me.es.js');

const GATEWAY_ID = 'test-ledger-id-abc123';

// ── HTTP + signing helpers, mirroring modules/monad's own
// keychainMinimalWalkthrough.test.ts conventions exactly, so this file's
// keychain setup is proven against the same real primitives that test
// already covers in isolation. ─────────────────────────────────────────

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

  return {
    namespace,
    identityHash,
    sign: (message: string) => signEd25519Proof(privateKey, message),
  };
}

// A freshly generated device/app key — never derived from any identity's
// seed, exactly how a real "register a new key" flow generates one
// locally before ever sending its public half to the server.
async function generateDeviceKey() {
  const seed = crypto.randomBytes(32);
  const { privateKey, publicKey } = await importEd25519SigningKey(new Uint8Array(seed));
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  return {
    publicKeyRaw,
    sign: (message: string) => signEd25519Proof(privateKey, message),
  };
}

type TestIdentity = Awaited<ReturnType<typeof claimTestIdentity>>;
type DeviceKey = Awaited<ReturnType<typeof generateDeviceKey>>;

/** Registers the FIRST keychain key for `identity`, authorized by its own claim (bootstrap path). */
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

/** Registers an additional keychain key, authorized by an already-active admin key (post-bootstrap path). */
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

/**
 * Builds and signs the exact canonical claim payload commitSignedClaim
 * reconstructs server-side — the local, portable signature
 * keychainClient.ts's signWithKeychainKey produces in the real browser
 * flow. `state` is NOT part of the signed payload (it round-trips
 * separately, see gatewaySetupSession.ts's own comments on why) — it's
 * attached to the returned proof object as its own field, matching
 * exactly what CleakerNetgetClaimView actually sends back.
 */
async function signNetgetClaim(
  deviceKey: { sign(message: string): Promise<string> },
  fields: { gatewayId: string; namespace: string; identityHash: string; keyId: string; challenge: string; state: string },
) {
  const timestamp = Date.now();
  const { state, ...signedFields } = fields;
  const payload = { op: 'netget-claim-gateway', ...signedFields, timestamp };
  const signature = await deviceKey.sign(normalizeProofMessage(payload));
  return { namespace: fields.namespace, identityHash: fields.identityHash, keyId: fields.keyId, signature, timestamp, state };
}

// This is netget's own real allowlisted callback path — see
// gatewaySetupSession.ts's ALLOWED_CLAIM_RETURN_PATHS. Every case below
// that just needs A valid challenge/state pair (not specifically testing
// the path/origin validation itself) uses this fixed pair.
const VALID_RETURN_ORIGIN = 'http://netget-test.local';
const VALID_RETURN_PATH = '/';

// 1) Correct code, minted once, works exactly once to unlock a session.
{
  const { code } = createSetupSession(GATEWAY_ID);
  const result = verifySetupCode(code);
  assert.equal(result.ok, true, 'the correct code must verify');
  assert.ok((result as any).setupToken, 'a successful verify must issue a setupToken');
}

// 2) Limited attempts: wrong guesses decrement and eventually lock the
// session out entirely, even with the right code still unused.
{
  const { code } = createSetupSession(GATEWAY_ID, 10 * 60 * 1000, 2);
  assert.equal(verifySetupCode('totally-wrong-1').ok, false);
  assert.equal(verifySetupCode('totally-wrong-2').ok, false);
  const stillTheRealCode = verifySetupCode(code);
  assert.equal(stillTheRealCode.ok, false, 'attempts must already be exhausted, even for the correct code');
}

// 3) The plaintext code is never retrievable — only its hash is on disk.
{
  const { code } = createSetupSession(GATEWAY_ID);
  const raw = fs.readFileSync(path.join(tmpDataDir, 'runtime', 'setup-session.json'), 'utf8');
  assert.ok(!raw.includes(code), 'the raw setup-session.json must never contain the plaintext code');
}

// 4) A fresh createSetupSession() invalidates whatever session came before
// (single active session at a time) — the previous code stops working.
{
  const first = createSetupSession(GATEWAY_ID);
  const second = createSetupSession(GATEWAY_ID);
  assert.equal(verifySetupCode(first.code).ok, false, 'a superseded session\'s code must no longer verify');
  assert.equal(verifySetupCode(second.code).ok, true, 'the newest session\'s code must verify');
}

// 5) issueClaimChallenge requires a real, unlocked setupToken, and issues
// the anti mix-up `state` token alongside the challenge.
{
  const bogus = issueClaimChallenge('not-a-real-token', VALID_RETURN_ORIGIN, VALID_RETURN_PATH);
  assert.equal(bogus.ok, false, 'a bogus setupToken must not get a challenge');

  const { code } = createSetupSession(GATEWAY_ID);
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  const real = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH);
  assert.equal(real.ok, true);
  assert.ok((real as any).challenge, 'a valid session must receive a challenge string');
  assert.ok((real as any).state, 'a valid session must receive a state token');
}

// 5b) The callback PATH is a real, exhaustive allowlist (netget's
// GatewaySetup only ever mounts at "/" — see
// ALLOWED_CLAIM_RETURN_PATHS) — a caller declaring any other path is
// refused before a challenge or state token is even minted.
{
  const { code } = createSetupSession(GATEWAY_ID);
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  const result = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, '/some/other/path');
  assert.equal(result.ok, false, 'a disallowed return path must be refused');
  assert.match((result as any).message ?? '', /return path is not allowed/i);
}

// 5b-2) "/netget" is the one deliberate second entry in
// ALLOWED_CLAIM_RETURN_PATHS — the disposable namespaceHome demo pilot
// mounts GatewaySetup there (its own "/" is reserved for the real
// CleakerLanding) — and must be accepted exactly like "/".
{
  const { code } = createSetupSession(GATEWAY_ID);
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  const result = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, '/netget');
  assert.equal(result.ok, true, 'the demo pilot\'s "/netget" mount must be an allowed return path');
}

// 5c) The callback ORIGIN must at least be a well-formed URL origin —
// garbage is refused the same way, before anything is minted.
{
  const { code } = createSetupSession(GATEWAY_ID);
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  const result = issueClaimChallenge(setupToken, 'not-a-url-at-all', VALID_RETURN_PATH);
  assert.equal(result.ok, false, 'a malformed return origin must be refused');
  assert.match((result as any).message ?? '', /valid return origin/i);
}

// 6) Before any surface is registered for a namespace, a well-formed
// claim attempt (real challenge, real state, plausibly-shaped fields)
// still refuses to proceed — checked BEFORE ever trying to reach a
// keychain, so "nobody's mesh-registered this namespace" reads as its own
// distinct, actionable failure rather than "key not found". Deterministic:
// apps.json under this test's own NETGET_DATA_DIR is empty until case 7
// seeds an entry for its own namespace.
{
  const { code } = createSetupSession(GATEWAY_ID);
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  const { state } = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; state: string };

  const proof = { namespace: 'nosurfaceuser.unregistered-namespace.local', identityHash: 'nosurfaceuser', keyId: 'irrelevant', signature: 'irrelevant', timestamp: Date.now(), state };
  const result = await commitSignedClaim(setupToken, proof as any);
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /live surface/i);
}

// 6b) Session expiry is checked before state ever gets a look — an
// expired session's setupToken stops resolving to a live record at all
// (loadLiveSession's own expiresAt check), so even a would-be-correct
// state can't rescue a claim attempt against a session that's timed out.
{
  const { code } = createSetupSession(GATEWAY_ID, 1); // 1ms TTL — expires almost immediately
  const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
  await new Promise((resolve) => setTimeout(resolve, 20));

  const challengeAfterExpiry = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH);
  assert.equal(challengeAfterExpiry.ok, false, 'an expired session must not issue a challenge at all');
  assert.match((challengeAfterExpiry as any).message ?? '', /invalid or has expired/i);
}

// 7) The full flow against a genuinely isolated, disposable monad this
// test starts and deletes itself — NETGET_MONAD_NAME (set at the top of
// this file, before any import) makes every function in
// netgetMonadProcess.ts resolve to THIS throwaway instance, never the
// real 'netget' one. Every rejection case below runs BEFORE the one
// successful claim, since bootstrapOwner() only ever allows one owner —
// after that, every other attempt would fail with "already has an owner"
// regardless of what else is wrong with it, which would mask exactly the
// failure mode each case means to prove.
{
  const startStatus = await startNetgetMonad();
  assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();

  // commitSignedClaim now resolves namespace -> monad via
  // topologyResolver.ts's resolveSurface(), reading the same apps.json
  // mesh registry a real reported app would populate. Seed ONE entry for
  // this test's own rootNamespace -- alice.<rootNamespace> and
  // bob.<rootNamespace> both resolve to it via resolveSurface's own
  // rootspaceOf() reduction, so one entry covers both identities below.
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

  try {
    // Alice: the identity that will become the real owner. Two keys:
    // KA1 (admin, bootstrap key — the one that actually claims the
    // gateway) and KA2 (non-admin, registered then revoked, to prove a
    // revoked key can't sign a claim).
    const alice = await claimTestIdentity(origin, 'alice', 'alice-secret', rootNamespace);
    const aliceKey1 = await generateDeviceKey();
    const aliceKey1Id = await registerFirstKeychainKey(origin, alice, aliceKey1, 'Alice\'s laptop');
    const aliceKey2 = await generateDeviceKey();
    const aliceKey2Id = await registerKeychainKeyViaActing(origin, alice.namespace, aliceKey1Id, aliceKey1, aliceKey2, 'Alice\'s old phone');
    await revokeKeychainKey(origin, alice.namespace, aliceKey1Id, aliceKey1, aliceKey2Id);

    // Bob: a second, unrelated identity with his own genuinely active key
    // — used to prove an attacker can't ride their OWN valid key into
    // claiming ownership under someone ELSE's identityHash.
    const bob = await claimTestIdentity(origin, 'bob', 'bob-secret', rootNamespace);
    const bobKey1 = await generateDeviceKey();
    const bobKey1Id = await registerFirstKeychainKey(origin, bob, bobKey1, 'Bob\'s laptop');

    // One setup session/challenge, reused across every rejection case
    // below — commitSignedClaim only ever consumes the session on an
    // actual successful commit, so a rejected attempt leaves it live for
    // the next one, exactly like a real user retrying after a mistake.
    const { code } = createSetupSession(GATEWAY_ID);
    const { setupToken } = verifySetupCode(code) as { ok: true; setupToken: string };
    const { challenge, state } = issueClaimChallenge(setupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; challenge: string; state: string };

    // 7a) A signature built over a DIFFERENT challenge than the one this
    // session actually issued must fail verification — proves the
    // session/challenge binding, not just "any valid key signature".
    // (state is still the real one here — this case is specifically
    // about the challenge/signature binding, not state.)
    {
      const forgedProof = await signNetgetClaim(aliceKey1, {
        gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
        keyId: aliceKey1Id, challenge: 'this-was-never-issued-by-the-server', state,
      });
      const result = await commitSignedClaim(setupToken, forgedProof);
      assert.equal(result.ok, false);
      assert.match(result.message ?? '', /signature verification failed/i);
    }

    // 7b) identityHash binding: Bob signs with his OWN genuinely active
    // key, under his OWN namespace — but asserts ALICE's identityHash as
    // the new owner. An active key only proves it belongs to Bob's
    // keychain; it must NOT be enough, on its own, to install a
    // different identity as owner.
    {
      const spoofedProof = await signNetgetClaim(bobKey1, {
        gatewayId: GATEWAY_ID, namespace: bob.namespace, identityHash: alice.identityHash,
        keyId: bobKey1Id, challenge, state,
      });
      const result = await commitSignedClaim(setupToken, spoofedProof);
      assert.equal(result.ok, false);
      assert.match(result.message ?? '', /does not match the asserted identity/i);
    }

    // 7c) A revoked key must be rejected even with an otherwise perfectly
    // valid, correctly-bound, correctly-signed claim.
    {
      const revokedProof = await signNetgetClaim(aliceKey2, {
        gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
        keyId: aliceKey2Id, challenge, state,
      });
      const result = await commitSignedClaim(setupToken, revokedProof);
      assert.equal(result.ok, false);
      assert.match(result.message ?? '', /revoked/i);
    }

    // 7c2) State absent: an otherwise perfectly valid, correctly-signed
    // claim with NO state at all must be rejected — checked before this
    // function even looks at namespace/identityHash/keyId.
    {
      const noStateProof = await signNetgetClaim(aliceKey1, {
        gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
        keyId: aliceKey1Id, challenge, state: '',
      });
      const result = await commitSignedClaim(setupToken, noStateProof);
      assert.equal(result.ok, false);
      assert.match(result.message ?? '', /does not match the setup attempt/i);
    }

    // 7c3) State changed: a well-formed but WRONG state (not the one this
    // session actually issued) must be rejected the same way — proves
    // this is a real comparison, not just an emptiness check.
    {
      const wrongStateProof = await signNetgetClaim(aliceKey1, {
        gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
        keyId: aliceKey1Id, challenge, state: 'this-state-was-never-issued-either',
      });
      const result = await commitSignedClaim(setupToken, wrongStateProof);
      assert.equal(result.ok, false);
      assert.match(result.message ?? '', /does not match the setup attempt/i);
    }

    // 7c4) Mix-up between two attempts: a SECOND session (which, by this
    // store's own single-active-session design, supersedes the first —
    // see createSetupSession's own doc comment) gets its own state. A
    // proof carrying THAT second session's state, submitted against the
    // FIRST session's now-superseded setupToken, must be rejected —
    // proves state genuinely binds a response to ONE specific attempt,
    // not just "some state was issued at some point". The first
    // session's setupToken no longer resolves to a live record at all
    // once superseded, so this also confirms that failure mode specifically.
    {
      const { code: mixupCode } = createSetupSession(GATEWAY_ID);
      const { setupToken: mixupSetupToken } = verifySetupCode(mixupCode) as { ok: true; setupToken: string };
      const { state: mixupState } = issueClaimChallenge(mixupSetupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; state: string };

      const mixedProof = await signNetgetClaim(aliceKey1, {
        gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
        keyId: aliceKey1Id, challenge, state: mixupState,
      });
      // Against the ORIGINAL (now-superseded) setupToken.
      const result = await commitSignedClaim(setupToken, mixedProof);
      assert.equal(result.ok, false, 'a superseded session must not accept anything, mixed-up state included');

    }

    // 7d) The real success path: Alice's genuinely active admin key,
    // correctly bound and signed. Re-establishes its OWN fresh session
    // (7c4 above deliberately superseded the one this block started
    // with), matching how a real retry after any rejected attempt works.
    const { code: finalCode } = createSetupSession(GATEWAY_ID);
    const { setupToken: finalSetupToken } = verifySetupCode(finalCode) as { ok: true; setupToken: string };
    const { challenge: finalChallenge, state: finalState } = issueClaimChallenge(finalSetupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; challenge: string; state: string };
    const claimProof = await signNetgetClaim(aliceKey1, {
      gatewayId: GATEWAY_ID, namespace: alice.namespace, identityHash: alice.identityHash,
      keyId: aliceKey1Id, challenge: finalChallenge, state: finalState,
    });
    const result = await commitSignedClaim(finalSetupToken, claimProof);
    assert.equal(result.ok, true, (result as any).message);
    assert.equal((result as any).ownerUsername, 'alice');

    const mgr = new GatewayClaimsManager();
    const persisted = mgr.read();
    assert.equal(persisted?.owner, alice.identityHash, 'the claim must actually be persisted, not just reported as ok');
    assert.ok(persisted?.pubkeys[alice.identityHash], 'owner\'s public key must be recorded for challenge-response auth');

    // 7e) Session consumption: the same setupToken/proof must not work a
    // second time (replay).
    const replay = await commitSignedClaim(finalSetupToken, claimProof);
    assert.equal(replay.ok, false, 'a consumed setup session must not accept a second commit');

    // 7f) "Restart" — a fresh manager instance reading the still-present
    // local file must show the exact same owner (the actual mechanism
    // behind "reinicio → mismo owner": the snapshot is a durable file on
    // disk, not process-lifetime state).
    const afterRestart = new GatewayClaimsManager();
    assert.equal(afterRestart.read()?.owner, alice.identityHash, 'owner must survive a fresh manager instance ("restart") unchanged');

    // 7g) Rebind-rejection: with the local cache still showing Alice as
    // owner, a SECOND claim attempt from Bob — a genuinely different,
    // validly-signed identity, correctly bound to HIS OWN namespace's real
    // claim — must still be rejected. There's no remote ledger to consult
    // anymore (authority is derived from each caller's own namespace
    // claim, and Bob's proof for HIS namespace is entirely legitimate on
    // its own terms), so this guarantee now lives in
    // materializeFromNamespaceClaim()'s own local-cache check: a gateway
    // already bound to one identity can't be silently taken over by a
    // second, unrelated (if equally valid) identity.
    {
      const { code: secondCode } = createSetupSession(GATEWAY_ID);
      const { setupToken: secondSetupToken } = verifySetupCode(secondCode) as { ok: true; setupToken: string };
      const { challenge: secondChallenge, state: secondState } = issueClaimChallenge(secondSetupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; challenge: string; state: string };
      const secondBootstrapProof = await signNetgetClaim(bobKey1, {
        gatewayId: GATEWAY_ID, namespace: bob.namespace, identityHash: bob.identityHash,
        keyId: bobKey1Id, challenge: secondChallenge, state: secondState,
      });
      const secondBootstrapResult = await commitSignedClaim(secondSetupToken, secondBootstrapProof);
      assert.equal(secondBootstrapResult.ok, false, 'a second, different identity must not be able to rebind an already-bound gateway');
      assert.match((secondBootstrapResult as any).message ?? '', /already bound to a different identity/i);
      assert.equal(new GatewayClaimsManager().read()?.owner, alice.identityHash, 'the original binding must be untouched by the rejected attempt');
    }

    // 7h) Removing gateway-claims.json is now ONLY a local cache eviction,
    // not a real reset — authority for a namespace-derived gateway lives in
    // the CANONICAL gatewayAuthority branch on the target monad's own `.me`
    // kernel (claim/gatewayAuthority.ts), not in this local file at all.
    // This is a deliberate strengthening over the OLD materializeFromNamespaceClaim-
    // only model (where local deletion genuinely meant "unbound" — see this
    // test's own prior version): a local file wipe must never be enough to
    // let a different identity silently take over an already-bound gateway.
    fs.rmSync(getGatewayClaimsPath(), { force: true });
    fs.rmSync(getGatewayClaimsVersionPath(), { force: true });
    assert.equal(new GatewayClaimsManager().read(), null, 'local snapshot cache is genuinely gone for this case');

    // Bob still cannot bind — the canonical branch on the monad still shows
    // Alice as owner, regardless of what netget's local cache says.
    const { code: thirdCode } = createSetupSession(GATEWAY_ID);
    const { setupToken: thirdSetupToken } = verifySetupCode(thirdCode) as { ok: true; setupToken: string };
    const { challenge: thirdChallenge, state: thirdState } = issueClaimChallenge(thirdSetupToken, VALID_RETURN_ORIGIN, VALID_RETURN_PATH) as { ok: true; challenge: string; state: string };
    const thirdProof = await signNetgetClaim(bobKey1, {
      gatewayId: GATEWAY_ID, namespace: bob.namespace, identityHash: bob.identityHash,
      keyId: bobKey1Id, challenge: thirdChallenge, state: thirdState,
    });
    const thirdResult = await commitSignedClaim(thirdSetupToken, thirdProof);
    assert.equal(thirdResult.ok, false, 'a local cache wipe must NOT let a different identity rebind — the canonical branch on the monad is still bound to Alice');
    assert.match((thirdResult as any).message ?? '', /already bound to a different identity/i);

    // And re-reading (as commitSignedClaim's own rejected attempt already
    // does internally, but confirmed explicitly here) restores Alice as
    // owner from the canonical branch alone — proving the local file was
    // only ever a cache, never the source of truth.
    const recovered = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
    await recovered.materializeFromGatewayAuthority(origin);
    assert.equal(recovered.read()?.owner, alice.identityHash, 'the local cache re-materialises the SAME canonical owner after a wipe, never a fresh bootstrap');
  } finally {
    await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  }
}

console.log('gateway-setup-session ok');
