/**
 * gateway-admin-session-gate.test.ts -- the gateway's AUTHORIZED clients, through the gate.
 *
 * Keeping a route's path does not make a client send the credential the gate now asks for. This
 * takes the client that does send one -- an admin who signed in (challenge -> signature with a live
 * keychain key -> session token) -- through the real gate, on a real monad with the gateway module:
 *   - the owner's session may use the mutating routes;
 *   - an admin without gateway:write may not, and the answer names the capability;
 *   - an admin who is granted gateway:write may;
 *   - a session dies with its key (revoked key -> the very next call is refused);
 *   - forged x-netget-* headers add nothing to any of them;
 *   - the routes that authenticate themselves (setup, admin-session, gateway-admin, logs) are
 *     reached without going through the gate's credential at all.
 * Disposable everything: temp data dir, an in-process monad on port 0.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-admin-gate-'));
const dataDir = path.join(tmp, 'netget-data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_MONAD_NAMESPACE = 'gate-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../src/gateway/monadModule.mjs');
const { createMonadApp } = await import('monad.ai');
// where the module mounts the gateway's routes: bare paths on this branch, /.gateway once they are moved
const PREFIX: string = (await import(modulePath)).GATEWAY_PREFIX ?? '';
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
// @ts-expect-error -- no .d.ts resolution across this relative path (see admin-session-live-keychain.test.ts).
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


const monadRoot = path.join(tmp, 'monad'); fs.mkdirSync(monadRoot, { recursive: true });
const app: any = await createMonadApp({
  cwd: monadRoot, seed: 'admin-gate-test-seed', namespace: 'gate-test.me',
  stateDir: path.join(monadRoot, 'me-state'), claimDir: path.join(monadRoot, 'claims'), selfConfigPath: path.join(monadRoot, 'self.json'),
  selfIdentity: 'gate-test.me', selfHostname: 'gate-test.me', selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local'], port: 0,
  guiPkgDistDir: monadRoot, mePkgDistDir: monadRoot, cleakerPkgDistDir: monadRoot, reactUmdDir: monadRoot, reactDomUmdDir: monadRoot,
  routesPath: path.join(monadRoot, 'routes.js'), modules: [modulePath], logger: false,
});
assert.deepEqual(app.monadModules.failed, [], JSON.stringify(app.monadModules.failed));
const server: import('node:http').Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.NETGET_MONAD_ORIGIN = origin;
const rootNamespace = 'gate-test.me';

try {
  // the mesh registry knows where this namespace's monad is (adminSession resolves the keychain through it)
  fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    apps: { 'test-surface': { id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0, lastSeenMs: Date.now(), ttlMs: 3_600_000, trust: 'owner',
      metadata: { namespace: rootNamespace, endpoint: origin }, tags: [] } },
  }));

  const alice = await claimTestIdentity(origin, 'alice', 'alice-secret', rootNamespace);
  const aliceKey = await generateDeviceKey();
  const aliceKeyId = await registerFirstKeychainKey(origin, alice, aliceKey, "Alice's laptop");
  const bob = await claimTestIdentity(origin, 'bob', 'bob-secret', rootNamespace);
  const bobKey = await generateDeviceKey();
  const bobKeyId = await registerFirstKeychainKey(origin, bob, bobKey, "Bob's laptop");

  // the gateway's claims (netget's local snapshot): alice owns it; bob is an admin who may only read
  const claimsPath = getGatewayClaimsPath();
  const writeClaims = (bobScopes: string[]) => fs.writeFileSync(claimsPath, JSON.stringify({
    gatewayId: 'admin-gate-test.local', owner: alice.identityHash,
    admins: { [alice.identityHash]: true, [bob.identityHash]: true },
    grants: { [alice.identityHash]: ['gateway:read'], [bob.identityHash]: bobScopes },
    pubkeys: {}, usernames: { [alice.identityHash]: 'alice', [bob.identityHash]: 'bob' },
  }, null, 2));
  writeClaims(['gateway:read']);

  const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${PREFIX}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  // the same steps a signed-in admin client takes: challenge -> sign with a live key -> session token
  const signIn = async (who: TestIdentity, key: DeviceKey, keyId: string): Promise<string> => {
    const challenge: any = await (await send('POST', '/admin-session/challenge', { identityHash: who.identityHash })).json();
    assert.equal(challenge.ok, true, JSON.stringify(challenge));
    const signature = await key.sign(challenge.challenge);
    const verified: any = await (await send('POST', '/admin-session/verify', { identityHash: who.identityHash, namespace: who.namespace, keyId, signature })).json();
    assert.equal(verified.ok, true, JSON.stringify(verified));
    return verified.sessionToken as string;
  };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const forged = { 'x-netget-identity': alice.identityHash, 'x-netget-scopes': JSON.stringify(['gateway:write']) };
  const addDomain = (headers: Record<string, string>, domain: string) => send('POST', '/add-domain', { domain, type: 'proxy', owner: 'netget' }, headers);

  const aliceToken = await signIn(alice, aliceKey, aliceKeyId);
  const bobToken = await signIn(bob, bobKey, bobKeyId);

  const listed = async () => ((await (await send('GET', '/domains')).json()) as any).domains.map((d: any) => d.domain).sort();

  // ── the owner's session: the mutating routes work, and the change is real ──
  assert.equal((await addDomain(bearer(aliceToken), 'owner-added.test')).status, 200);
  assert.deepEqual(await listed(), ['owner-added.test']);
  assert.equal((await send('POST', '/update-domain', { domain: 'owner-added.test', updatedFields: { target: 'http://127.0.0.1:9000' } }, bearer(aliceToken))).status, 200);
  assert.equal((await send('POST', '/apps/report', { name: 'app-x', host: '127.0.0.1', port: 9001 }, bearer(aliceToken))).status < 500, true);

  // ── an admin without gateway:write is refused, and the answer names what is missing ──
  const denied = await addDomain(bearer(bobToken), 'bob-added.test');
  assert.equal(denied.status, 403);
  const deniedBody: any = await denied.json();
  assert.equal(deniedBody.error, 'CAPABILITY_DENIED'); assert.equal(deniedBody.required, 'gateway:write');
  // ...and forged headers claiming the owner's identity and the capability change nothing for him
  assert.equal((await addDomain({ ...bearer(bobToken), ...forged }, 'bob-forged.test')).status, 403);
  assert.deepEqual(await listed(), ['owner-added.test']);

  // ── granted the capability, the same session (scopes are read fresh on every call) works ──
  writeClaims(['gateway:read', 'gateway:write']);
  assert.equal((await addDomain(bearer(bobToken), 'bob-added.test')).status, 200);
  assert.deepEqual(await listed(), ['bob-added.test', 'owner-added.test']);
  writeClaims(['gateway:read']); // taken back: the next call is refused again
  assert.equal((await addDomain(bearer(bobToken), 'bob-again.test')).status, 403);

  // ── no session at all, whatever else is sent ──────────────────────────────
  for (const headers of [{}, forged, { authorization: 'Bearer nobody' }]) assert.equal((await addDomain(headers, 'nobody.test')).status, 401);
  assert.equal((await send('POST', '/delete-domain', { domain: 'owner-added.test' })).status, 401);
  assert.deepEqual(await listed(), ['bob-added.test', 'owner-added.test']);
  assert.equal((await send('POST', '/delete-domain', { domain: 'owner-added.test' }, bearer(aliceToken))).status, 200);
  assert.deepEqual(await listed(), ['bob-added.test']);

  // ── a session dies with its key: revoke the key it was signed with -> the very next call is refused ──
  const bobKey2 = await generateDeviceKey();
  const bobKey2Id = await registerKeychainKeyViaActing(origin, bob.namespace, bobKeyId, bobKey, bobKey2, "Bob's phone", true);
  writeClaims(['gateway:read', 'gateway:write']);
  assert.equal((await addDomain(bearer(bobToken), 'bob-before-revoke.test')).status, 200);
  await revokeKeychainKey(origin, bob.namespace, bobKey2Id, bobKey2, bobKeyId);
  assert.equal((await addDomain(bearer(bobToken), 'bob-after-revoke.test')).status, 401, 'the session signed by the revoked key no longer works');
  const bobToken2 = await signIn(bob, bobKey2, bobKey2Id);
  assert.equal((await addDomain(bearer(bobToken2), 'bob-new-key.test')).status, 200, 'the same admin, on the key that is live, does');

  // ── the routes that authenticate themselves do not go through the gate's credential ──
  const gateError = (b: any) => b?.error === 'ADMIN_SESSION_REQUIRED' || b?.error === 'CAPABILITY_DENIED';
  for (const [method, p, body] of [['POST', '/setup/verify-code', { code: 'nope' }], ['POST', '/setup/challenge', {}], ['POST', '/gateway-admin/grant', {}],
    ['POST', '/gateway-admin/revoke', {}], ['POST', '/gateway-admin/transfer', {}], ['POST', '/admin-session/challenge', { identityHash: 'nobody' }]] as const) {
    const r = await send(method, p, body);
    assert.equal(gateError(await r.json().catch(() => null)), false, `${method} ${p} is answered by its own route, not the gate`);
  }
  // /logs: its own bearer check (gateway:read), which an admin session satisfies -- the gate does not add write to it
  const anonymousLogs = await send('GET', '/logs');
  assert.equal(anonymousLogs.status, 401); assert.equal((await anonymousLogs.json() as any).error, 'SESSION_TOKEN_REQUIRED');
  const aliceLogs = await send('GET', '/logs?type=server', undefined, bearer(aliceToken));
  assert.equal(aliceLogs.status, 200, 'an admin session with gateway:read reads the logs');
  // public reads stay public
  for (const p of ['/gateway-identity', '/main-server-namespace', '/domains', '/healthcheck']) assert.equal((await send('GET', p)).status, 200, p);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('gateway-admin-session-gate.test.ts: all assertions passed');
process.exit(0);
