import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// A real, unrelated key -- never registered in anyone's keychain -- used
// only to produce a signature that must fail verification. Everything
// that actually needs to succeed goes through a REAL claimed identity and
// a REAL keychain key below (adminSession.ts now verifies against the
// LIVE keychain, never a hand-written pubkeys snapshot -- see
// admin-session-live-keychain.test.ts for the dedicated rotation/
// revocation proof; this file only needs one genuinely active key to
// drive the logs path end to end).
const { privateKey: otherPrivateKey } = crypto.generateKeyPairSync('ed25519');

function signChallenge(privateKey: crypto.KeyObject, challenge: string): string {
  const signature = crypto.sign(null, Buffer.from(challenge, 'utf8'), privateKey);
  return signature.toString('base64url');
}

function randomNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

// End-to-end coverage for reading `logs.access`/`logs.error` through the
// real .me/NRP path — netget's OWN disposable monad (via monad.ai's
// pathResolver.ts, generic there) proxying to netget's OWN disposable
// Express backend (the real /logs route in routes/localNetget.js, the
// same one Storybook's LogsView.stories.tsx "Live" story and the earlier
// manual curl both hit). Nothing here is a mock of that route's logic —
// it's the real router, mounted directly, pointed at a fake access.log
// fixture instead of a real nginx log directory.
//
// Disposable throughout: fresh NETGET_DATA_DIR (setup-session/claims
// state), a hand-written gateway-claims.json (no real ledger/monad
// write), a fake access.log fixture (never a real nginx log dir), and
// netget's own disposable monad (reservePort + guard, same pattern as
// domain-store-dotted-domains.test.ts etc.) -- never the real gateway.

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-logs-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `logs-nrp-test-${process.pid}.local`;

const TEST_MONAD_NAME = `logs-nrp-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

// Fake nginx logs directory -- one realistic access.log line, real format
// (see proxy.js's parseNginxAccessLog regex), never a real OpenResty dir.
const fakeLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fake-nginx-logs-'));
fs.writeFileSync(
  path.join(fakeLogsDir, 'access.log'),
  '127.0.0.1 - - [11/Sep/2026:10:30:00 +0000] "GET /gateway-identity HTTP/1.1" 200 512 "-" "Mozilla/5.0"\n',
  'utf8',
);
process.env.NGINX_LOGS_PATH = fakeLogsDir;

const { createLocalNetgetTestApp } = await import('../src/htmls/Netget-REACT/backend/testHarness.mjs');
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { startNetgetMonad, getNetgetMonadOrigin, getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');
const { readMonadRecord, deleteMonadProcess } = await import('monad.ai');
// Same reasoning as gateway-setup-session.test.ts's own identical import:
// 'this.me' (published) lacks these newer primitives; reach the local
// workspace build directly.
// @ts-expect-error -- no .d.ts resolution across this relative path.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } =
  await import('../../../../me/Typescript/dist/me.es.js');

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
  return { publicKeyRaw, privateKey, sign: (message: string) => signEd25519Proof(privateKey, message) };
}

async function registerFirstKeychainKey(origin: string, identity: { namespace: string; identityHash: string; sign(message: string): Promise<string> }, deviceKey: { publicKeyRaw: string }, label: string) {
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

// netget's own real backend, standing in as the LOG_SOURCE_URL this run's
// disposable monad will proxy `logs.*` reads to -- the actual router from
// routes/localNetget.js, not a stand-in.
const backendApp = createLocalNetgetTestApp();
const backendPort = await reservePort();
const backendServer = backendApp.listen(backendPort, '127.0.0.1');
await new Promise<void>((resolve) => backendServer.once('listening', () => resolve()));
process.env.LOG_SOURCE_URL = `http://127.0.0.1:${backendPort}`;
// The ONE namespace this monad's logs proxy answers for -- a read under
// any other namespace must fall straight through untouched (see
// logsSourceProxy.ts's shouldInterceptLogsPath, covered directly in
// monad.ai's own test suite; this test only needs ONE consistent value
// to drive the end-to-end path, not re-prove that scoping itself here).
const LOG_NAMESPACE = `netget.logs-nrp-test-${process.pid}.local`;
process.env.LOG_SOURCE_NAMESPACE = LOG_NAMESPACE;

// Reserve the monad's exact port and arm the guard for it BEFORE starting
// anything -- same closed-window pattern as the other disposable-monad
// tests. This test's OWN process only ever calls fetch() against the
// monad's origin below; the internal proxy hop to LOG_SOURCE_URL happens
// inside the SPAWNED MONAD'S OWN CHILD PROCESS, not this one, so it's
// outside what this guard observes -- by design, not an oversight (the
// guard protects THIS process's outbound calls, same as every other test
// that uses it).
const reservedMonadPort = await reservePort();
const monadExpectedOrigin = `http://127.0.0.1:${reservedMonadPort}`;
// This test deliberately also talks directly to netget's own disposable
// Express backend (steps 1-4 below, proving the Express-direct path
// rejects/accepts correctly on its own) -- both origins are genuinely
// this test's own disposable infra, not a drift the guard should catch.
const originGuard = installMonadOriginGuard([monadExpectedOrigin, `http://127.0.0.1:${backendPort}`]);

const startStatus = await startNetgetMonad({ port: reservedMonadPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);
const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
assert.ok(ownRecord, 'the disposable monad must be registered under its own unique name');
assert.equal(ownRecord!.port, reservedMonadPort, 'must have landed on the exact reserved port');
const resolvedOrigin = await getNetgetMonadOrigin();
assert.equal(resolvedOrigin, monadExpectedOrigin);
const realRecord = await readMonadRecord('netget').catch(() => null);
if (realRecord) {
  assert.notEqual(ownRecord!.port, realRecord.port, 'must never resolve to the real ambient "netget" monad\'s port');
}

const backendBase = `http://127.0.0.1:${backendPort}`;

// adminSession.ts now resolves namespace -> monad via topologyResolver.ts's
// resolveSurface() (same mechanism gateway-setup-session.test.ts's case 7
// and admin-session-live-keychain.test.ts seed) -- one entry for this
// test's own rootNamespace covers logsadmin.<rootNamespace> via
// resolveSurface's rootspaceOf() reduction.
{
  const rootNamespaceForSeed = getGatewayRootNamespace();
  const registryDir = path.join(tmpDataDir, 'runtime');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    apps: {
      'test-surface': {
        id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0,
        lastSeenMs: Date.now(), ttlMs: 45_000, trust: 'owner',
        metadata: { namespace: rootNamespaceForSeed, endpoint: resolvedOrigin },
        tags: [],
      },
    },
  }, null, 2), 'utf8');
}

// A real claimed identity + a real, genuinely active keychain key --
// adminSession.ts now verifies against the LIVE keychain (fetched from
// this same disposable monad, per keychainKeyVerification.ts), never a
// hand-written pubkeys snapshot (see admin-session-live-keychain.test.ts
// for the dedicated rotation/revocation proof; this file only needs one
// genuinely active key to drive the logs path end to end). Netget's OWN
// admin grant (owner/admins/grants) is a separate, hand-written concern --
// GatewayClaimsManager reads that locally, matching
// openresty-install-action.test.ts's own pattern.
const rootNamespace = getGatewayRootNamespace();
const logsAdmin = await claimTestIdentity(resolvedOrigin, 'logsadmin', 'logsadmin-secret', rootNamespace);
const adminKey = await generateDeviceKey();
const adminKeyId = await registerFirstKeychainKey(resolvedOrigin, logsAdmin, adminKey, "logs admin's key");
const ADMIN_IDENTITY = logsAdmin.identityHash;

const claimsPath = getGatewayClaimsPath();
fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
fs.writeFileSync(claimsPath, JSON.stringify({
  gatewayId: 'logs-nrp-test.local',
  owner: ADMIN_IDENTITY,
  admins: { [ADMIN_IDENTITY]: true },
  grants: { [ADMIN_IDENTITY]: ['gateway:read'] },
  pubkeys: {},
  usernames: { [ADMIN_IDENTITY]: 'logsadmin' },
}, null, 2), 'utf8');

try {
  // ── 1. Forged identity headers, hit Express DIRECTLY, no session ──────
  // Exactly the attack this whole mechanism exists to stop: a caller that
  // bypasses nginx entirely (so no real signature was ever checked) just
  // sets the headers /domains/metadata would have trusted. The /logs
  // route must never look at these headers at all any more.
  const forgedDirectRes = await fetch(`${backendBase}/logs?type=access&limit=5`, {
    headers: {
      'x-netget-identity': ADMIN_IDENTITY,
      'x-netget-scopes': JSON.stringify(['gateway:read']),
    },
  });
  assert.equal(forgedDirectRes.status, 401, 'forged headers alone, hitting Express directly, must never be enough');
  assert.equal((await forgedDirectRes.json()).error, 'SESSION_TOKEN_REQUIRED');

  // ── 2. Real challenge/response with the WRONG key -- must be rejected ──
  const challengeRes = await fetch(`${backendBase}/admin-session/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityHash: ADMIN_IDENTITY }),
  });
  assert.equal(challengeRes.status, 200);
  const { challenge } = await challengeRes.json();
  assert.ok(challenge, 'a real challenge must be issued for a real admin');

  const wrongKeySignature = signChallenge(otherPrivateKey, challenge);
  const wrongKeyVerifyRes = await fetch(`${backendBase}/admin-session/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityHash: ADMIN_IDENTITY, namespace: logsAdmin.namespace, keyId: adminKeyId, signature: wrongKeySignature }),
  });
  assert.equal(wrongKeyVerifyRes.status, 401, 'a signature from a DIFFERENT key must never mint a session for this identity');
  assert.equal((await wrongKeyVerifyRes.json()).message, 'INVALID_SIGNATURE');

  // The rejected attempt must not have consumed the challenge -- a second,
  // genuine signature over the SAME challenge should still work below.

  // ── 3. Real challenge/response with the REAL admin key -- must succeed ──
  const realSignature = await adminKey.sign(challenge);
  const verifyRes = await fetch(`${backendBase}/admin-session/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityHash: ADMIN_IDENTITY, namespace: logsAdmin.namespace, keyId: adminKeyId, signature: realSignature }),
  });
  assert.equal(verifyRes.status, 200, JSON.stringify(await verifyRes.clone().json()));
  const { sessionToken } = await verifyRes.json();
  assert.ok(sessionToken, 'a genuine signature from the registered admin key must mint a real session token');

  // ── 4. That session, presented directly to Express -- real data back ───
  const directAuthedRes = await fetch(`${backendBase}/logs?type=access&limit=5`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(directAuthedRes.status, 200);
  const directLogs = (await directAuthedRes.json()).logs;
  assert.equal(directLogs.length, 1);
  assert.equal(directLogs[0].path, '/gateway-identity');

  // ── 5. Forged identity headers via the MONAD's own NRP surface, no
  // session -- must be rejected exactly the same way as #1. This is the
  // OTHER direct-access path (bypassing nginx by reaching monad.ai's HTTP
  // surface instead of Express's) -- both must fail closed.
  const forgedViaMonadRes = await fetch(`${resolvedOrigin}/logs.access?limit=5`, {
    headers: {
      'x-forwarded-host': LOG_NAMESPACE,
      'x-netget-identity': ADMIN_IDENTITY,
      'x-netget-scopes': JSON.stringify(['gateway:read']),
    },
  });
  assert.equal(forgedViaMonadRes.status, 401, 'forged headers via the monad path must also never be enough');
  assert.equal((await forgedViaMonadRes.json()).error, 'SESSION_TOKEN_REQUIRED');

  // ── 6. The REAL session, via the MONAD's NRP surface -- full round trip:
  // NRP read -> pathResolver.ts's namespace-scoped logs branch -> HTTP
  // proxy (Authorization forwarded, forged headers dropped) -> the real
  // /logs route -> real admin-session verification -> real parsed line.
  const authedViaMonadRes = await fetch(`${resolvedOrigin}/logs.access?limit=5`, {
    headers: {
      'x-forwarded-host': LOG_NAMESPACE,
      authorization: `Bearer ${sessionToken}`,
    },
  });
  assert.equal(authedViaMonadRes.status, 200, JSON.stringify(await authedViaMonadRes.clone().json()));
  const authedBody = await authedViaMonadRes.json();
  assert.equal(authedBody.disclosure, 'public');
  const logs = authedBody.target.value.logs;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].method, 'GET');
  assert.equal(logs[0].path, '/gateway-identity');
  assert.equal(logs[0].status, 200);

  // ── 7. A DIFFERENT namespace, same real session -- must fall through
  // untouched (genuinely absent), never return this host's logs.
  const wrongNamespaceRes = await fetch(`${resolvedOrigin}/logs.access?limit=5`, {
    headers: {
      'x-forwarded-host': `netget.someone-else-${process.pid}.local`,
      authorization: `Bearer ${sessionToken}`,
    },
  });
  assert.equal(wrongNamespaceRes.status, 404, 'a different namespace must never resolve to this host\'s own logs');

  console.log('logs-nrp-integration ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
  await new Promise<void>((resolve) => backendServer.close(() => resolve()));
}
