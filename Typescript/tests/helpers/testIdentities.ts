// testIdentities.ts -- identities for the disposable gateway tests: claimed in the disposable monad with their own
// signing key, a device key registered in their keychain, and (provisionAdmins) a real admin session obtained through the
// gateway's own flow: POST /admin-session/challenge -> sign with the keychain key -> POST /admin-session/verify.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { meDistUrl } = await import('../_meDist.ts');
// @ts-expect-error -- no .d.ts resolution across this path; the runtime import reaches the workspace build.
const me: any = await import(meDistUrl());
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } = me;

const randomNonce = () => crypto.randomBytes(16).toString('base64url');
async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

export interface TestAdmin {
  username: string;
  identityHash: string;
  namespace: string;
  keyId: string;
  sign(message: string): Promise<string>;
}

export async function claimIdentityWithKey(monadOrigin: string, username: string, secret: string, rootNamespace: string): Promise<TestAdmin> {
  const namespace = `${username}.${rootNamespace}`;
  const { privateKey, publicKey } = await importEd25519SigningKey(await deriveBranchProofSeed(secret, username));
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  const timestamp = Date.now();
  const proofMessage = normalizeProofMessage({ identityHash: username, expression: username, namespace, rootNamespace, challenge: null, timestamp });
  const claim = await post(monadOrigin, '/', {
    operation: 'claim', namespace, secret, identityHash: username,
    proof: { message: proofMessage, signature: await signEd25519Proof(privateKey, proofMessage), publicKey: publicKeyRaw, timestamp },
  });
  if (claim.status !== 201) throw new Error(`claim ${username}: ${claim.status} ${JSON.stringify(claim.json)}`);
  const rootSign = (m: string) => signEd25519Proof(privateKey, m);

  const device = await importEd25519SigningKey(new Uint8Array(crypto.randomBytes(32)));
  const deviceRaw = Buffer.from(await crypto.subtle.exportKey('raw', device.publicKey)).toString('base64url');
  const nonce = randomNonce();
  const ts = Date.now();
  const newKey = { publicKey: deviceRaw, label: username };
  const signature = await rootSign(normalizeProofMessage({ op: 'keychain-register', namespace, newKey, nonce, timestamp: ts, identityHash: username }));
  const reg = await post(monadOrigin, '/api/v1/keychain/keys', { namespace, identityHash: username, newKey, nonce, timestamp: ts, signature });
  if (reg.status !== 201) throw new Error(`keychain ${username}: ${reg.status} ${JSON.stringify(reg.json)}`);
  return { username, identityHash: username, namespace, keyId: reg.json.key.keyId, sign: (m: string) => signEd25519Proof(device.privateKey, m) };
}

/** The gateway's own sign-in: the challenge it issues, signed with the keychain key, exchanged for a session token. */
export async function signInThrough(origin: string, who: TestAdmin): Promise<string> {
  const challenge = await post(origin, '/admin-session/challenge', { identityHash: who.identityHash });
  if (!challenge.json?.ok) throw new Error(`challenge ${who.username}: ${challenge.status} ${JSON.stringify(challenge.json)}`);
  const verified = await post(origin, '/admin-session/verify', {
    identityHash: who.identityHash, namespace: who.namespace, keyId: who.keyId, signature: await who.sign(challenge.json.challenge),
  });
  if (!verified.json?.ok) throw new Error(`verify ${who.username}: ${verified.status} ${JSON.stringify(verified.json)}`);
  return verified.json.sessionToken as string;
}

export function writeGatewayClaims(claimsPath: string, gatewayId: string, owner: string, grants: Record<string, string[]>) {
  const identities = Object.keys(grants);
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  fs.writeFileSync(claimsPath, JSON.stringify({
    gatewayId, owner,
    admins: Object.fromEntries(identities.map((i) => [i, true])),
    grants, pubkeys: {}, usernames: Object.fromEntries(identities.map((i) => [i, i])),
  }, null, 2));
}

/** The mesh registry entry the gateway resolves a namespace's keychain through, plus one live registered app (`app:demo`). */
export function writeAppsRegistry(runtimeDir: string, rootNamespace: string, monadOrigin: string) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const monadPort = Number(new URL(monadOrigin).port) || 0;
  fs.writeFileSync(path.join(runtimeDir, 'apps.json'), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    apps: {
      'test-surface': { id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0, lastSeenMs: Date.now(), ttlMs: 3_600_000, trust: 'owner', metadata: { namespace: rootNamespace, endpoint: monadOrigin }, tags: [] },
      // the gateway's own monad, registered the way a monad registers itself (the front end asks /apps/netget/ for its surface)
      netget: { id: 'netget', name: 'monad:netget', kind: 'monad', host: '127.0.0.1', port: monadPort, lastSeenMs: Date.now(), ttlMs: 24 * 3600_000, trust: 'owner',
        metadata: { monadName: 'netget', namespace: rootNamespace, identity: rootNamespace, endpoint: monadOrigin, directEndpoint: monadOrigin, claimed_namespaces: [rootNamespace] }, tags: ['monad', 'local'] },
      a: { name: 'monad:demo', kind: 'monad', host: '127.0.0.1', port: 9, ttlMs: 24 * 3600_000, lastSeenMs: Date.now(), trust: 'peer', metadata: { monadName: 'demo' }, exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } } },
    },
  }));
}
