/**
 * gateway-authority-durability.test.ts — proves the E+A canonical branch
 * survives a REAL process restart (kill + relaunch the actual monad OS
 * process, not just re-instantiating a JS object in the same process), and
 * that an unverifiable/different destination never gets treated as "this
 * installation was never claimed."
 *
 * Two guarantees, both from the same underlying requirement ("vinculación
 * durable"):
 *   1. After deleting ONLY netget's local gateway-claims.json cache and
 *      genuinely restarting the monad process (restartMonadProcess --
 *      terminate + relaunch, same state dir on disk), netget must recover
 *      the SAME owner by reading the canonical branch back.
 *   2. A materialize call against an UNREACHABLE or WRONG surface URL must
 *      NEVER downgrade a real local cache to "needs bootstrap" -- see
 *      GatewayClaimsManager.materializeFromGatewayAuthority's own doc
 *      comment (fixed 2026-09: it used to do exactly that on any fetch
 *      failure or non-OK response).
 *
 * Real disposable monad throughout (reservePort + installMonadOriginGuard
 * + startNetgetMonad/restartMonadProcess), never the real ambient one.
 * Self-identity config is isolated by construction here: startMonadProcess
 * (monad.ai's own CLI runtime) always sets MONAD_SELF_CONFIG_PATH
 * explicitly to a path under this test's own disposable runtime dir --
 * never falls through to the real ambient self.json.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gwauth-durability-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const TEST_MONAD_NAME = `gwauth-durability-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const CLAIMED_NAMESPACE = `gwauth-durability-owner-${Date.now().toString(36)}.cleaker.me`;
process.env.NETGET_MONAD_NAMESPACE = CLAIMED_NAMESPACE;

const GATEWAY_ID = 'gwauth-durability-test.local';

const { startNetgetMonad, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { GatewayClaimsManager } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { issueInstallationAuthorization, readInstallationAuthorization, readMonadRecord, restartMonadProcess, deleteMonadProcess } = await import('monad.ai');
// @ts-expect-error -- no .d.ts resolution across this relative path; see
// gateway-setup-session.test.ts's identical note.
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
  const claimRes = await post(origin, '/', {
    operation: 'claim', namespace, secret, identityHash,
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

async function bootstrapGateway(origin: string, identity: Awaited<ReturnType<typeof claimTestIdentity>>, keyId: string, key: Awaited<ReturnType<typeof generateDeviceKey>>) {
  const challenge = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const signedFields = { op: 'netget-claim-gateway', gatewayId: GATEWAY_ID, namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp };
  const signature = await key.sign(normalizeProofMessage(signedFields));
  return post(origin, `/api/v1/gateway/${GATEWAY_ID}/bootstrap`, { namespace: identity.namespace, identityHash: identity.identityHash, keyId, challenge, timestamp, signature, username: identity.identityHash });
}

const reservedPort = await reservePort();
// The second entry is a deliberately-unreachable LOOPBACK port (nothing
// ever listens on 1) used below to prove an unverifiable destination
// preserves the local cache -- allow-listing it here means that fetch
// genuinely fails at the TCP level, not because this test's own safety
// guard blocked it (which would itself fail the whole process at exit).
let activeGuard = installMonadOriginGuard([`http://127.0.0.1:${reservedPort}`, 'http://127.0.0.1:1']);

const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);

try {
  const origin = startStatus.origin;
  const rootNamespace = getGatewayRootNamespace();
  assert.equal(rootNamespace, CLAIMED_NAMESPACE);

  const owner = await claimTestIdentity(origin, 'owner1', 'owner1-secret', rootNamespace);
  const ownerKey = await generateDeviceKey();
  const ownerKeyId = await registerFirstKeychainKey(origin, owner, ownerKey, "Owner's laptop");

  // Stands in for netget's own setup-code ceremony (gatewaySetupSession.ts),
  // bypassed here the same way bootstrapGateway() itself bypasses the rest
  // of that session — a real bootstrap now requires proof of installation
  // authorization, not just a valid namespace claim + key.
  const ownRecordBeforeBootstrap = await readMonadRecord(TEST_MONAD_NAME);
  assert.ok(ownRecordBeforeBootstrap, 'the disposable monad must have a real process record');
  const authIssued = issueInstallationAuthorization({
    stateDir: ownRecordBeforeBootstrap!.stateDir,
    gatewayId: GATEWAY_ID,
    namespace: owner.namespace,
    identityHash: owner.identityHash,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  assert.ok(authIssued.ok, `installation authorization must be issuable: ${JSON.stringify(authIssued)}`);

  const bootstrapRes = await bootstrapGateway(origin, owner, ownerKeyId, ownerKey);
  assert.equal(bootstrapRes.status, 201, `bootstrap must succeed: ${JSON.stringify(bootstrapRes.json)}`);
  assert.equal(
    readInstallationAuthorization(ownRecordBeforeBootstrap!.stateDir, GATEWAY_ID)?.status, 'consumed',
    'the installation authorization itself must be marked consumed once the bootstrap durably succeeds',
  );

  const mgr = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await mgr.materializeFromGatewayAuthority(origin);
  assert.equal(mgr.read()?.owner, owner.identityHash, 'local cache bound to the real claimed owner before restart');

  // ── Guarantee 2 (checked first, doesn't need a restart): an unreachable
  // / wrong destination must NEVER downgrade the local cache. ────────────
  const bogusOrigin = 'http://127.0.0.1:1'; // reserved/unlikely-to-be-listening port
  await mgr.materializeFromGatewayAuthority(bogusOrigin);
  assert.equal(
    mgr.read()?.owner, owner.identityHash,
    'an unverifiable destination must preserve the existing local cache, never silently reset it to "needs bootstrap"',
  );
  assert.equal(mgr.needsBootstrap(), false, 'still correctly bootstrapped after an unverifiable materialize attempt');

  // ── Guarantee 1: delete ONLY the local cache, REALLY restart the monad
  // process (terminate + relaunch, same on-disk state dir), then confirm
  // netget recovers the SAME owner from the canonical branch alone. ──────
  const { getGatewayClaimsPath, getGatewayClaimsVersionPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
  fs.rmSync(getGatewayClaimsPath(), { force: true });
  fs.rmSync(getGatewayClaimsVersionPath(), { force: true });
  assert.equal(new GatewayClaimsManager(GATEWAY_ID, { ledger: false }).read(), null, 'local cache genuinely gone before restart');

  const restarted = await restartMonadProcess(TEST_MONAD_NAME);
  assert.ok(restarted.pidAlive, `monad process must actually be running after a real restart: ${restarted.error || restarted.status}`);
  const restartedRecord = await readMonadRecord(TEST_MONAD_NAME);
  assert.ok(restartedRecord, 'restarted monad must still be registered under its own name');
  const restartedOrigin = restartedRecord!.endpoint;
  // restartMonadProcess() defaults to reusing the same port, so this is
  // normally a no-op re-arm of the identical allow-list — but re-arming
  // explicitly (rather than assuming) keeps this test honest if the OS
  // ever hands back a different port after the kill.
  activeGuard.uninstall();
  activeGuard = installMonadOriginGuard([restartedOrigin, 'http://127.0.0.1:1']);

  const recovered = new GatewayClaimsManager(GATEWAY_ID, { ledger: false });
  await recovered.materializeFromGatewayAuthority(restartedOrigin);
  assert.equal(
    recovered.read()?.owner, owner.identityHash,
    'after a REAL process restart (kill + relaunch, same on-disk state), the canonical branch alone must still show the original owner',
  );
  assert.equal(recovered.needsBootstrap(), false, 'restarted installation is NOT a fresh, unbootstrapped one');

  // The installation authorization's own "consumed" bookkeeping survives
  // the same REAL restart (plain local JSON on the same on-disk stateDir,
  // not kept only in memory) -- checked against the restarted record's own
  // stateDir, not assumed to be the same string as before the restart.
  assert.equal(
    readInstallationAuthorization(restartedRecord!.stateDir, GATEWAY_ID)?.status, 'consumed',
    'installation authorization bookkeeping must also survive a real process restart',
  );

  // A different, unrelated identity must still not be able to bootstrap
  // this gatewayId post-restart -- the canonical branch, not the local
  // cache, is what actually gates this.
  const impostor = await claimTestIdentity(restartedOrigin, 'impostor1', 'impostor1-secret', rootNamespace);
  const impostorKey = await generateDeviceKey();
  const impostorKeyId = await registerFirstKeychainKey(restartedOrigin, impostor, impostorKey, "Impostor's laptop");
  const impostorAttempt = await bootstrapGateway(restartedOrigin, impostor, impostorKeyId, impostorKey);
  assert.equal(impostorAttempt.status, 409);
  assert.equal(impostorAttempt.json.error, 'ALREADY_BOOTSTRAPPED');
} finally {
  activeGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
}

console.log('gateway-authority-durability ok');
