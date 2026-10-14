/**
 * standalone-backend-gate.test.ts -- the backend that runs on the machine (proxy.js, standalone) applies the
 * gateway's authorization where the write is executed.
 *
 * It used to mount the routers with no gate at all ("loopback only: nginx's job"), so anything that could reach
 * 127.0.0.1:3000 could add a route -- the panel's permission summary was a drawing of a check that nobody made. It now
 * mounts them through the same gate as the monad-mounted gateway (gateway/monadModule.mjs mountGatewayRouters).
 *
 * This test starts THAT entry point (a child process, tests/helpers/standaloneBackend.ts), on disposable data, with a
 * monad of its own, and refuses to send a write unless the backend has proven it is the disposable one (a marker
 * namespace that only this run configured). Nothing here touches the machine's gateway, monads or data.
 *
 * Checked: anonymous refusal (with forged identity headers and a bogus bearer), the three public reads that stay
 * public, a read-only admin (reads the configuration, refused the writes, with the capability named), an owner and an
 * admin who is granted gateway:write (connect -> change destination -> disconnect, a destination the validation
 * refuses), a grant taken back, and that the machine's own gateway files were not touched.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL_HOME = os.homedir();
const realMapPath = path.join(REAL_HOME, '.get', 'runtime', 'domain-map.json');
const mtimeOf = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null);
const realFiles = ['domain-map.json', 'domain-metadata.json', 'audit.log', 'gateway-claims.json'].map((f) => path.join(REAL_HOME, '.get', 'runtime', f));
const realMapBefore = mtimeOf(realMapPath);
const realBefore = realFiles.map(mtimeOf);

const { startDisposableStandalone } = await import('./helpers/standaloneBackend.ts');
const { meDistUrl } = await import('./_meDist.ts');
// @ts-expect-error -- no .d.ts resolution across this path; the runtime import reaches the workspace build.
const { deriveBranchProofSeed, importEd25519SigningKey, normalizeProofMessage, signEd25519Proof } = await import(meDistUrl());

// STANDALONE_TEST_DEFAULT_NAMESPACE=1 runs the same walk under the machine's own default namespace (`localhost`), which is
// what the real local netget is configured with; the disposable proof is then the process ownership of the port.
const defaultNamespace = process.env.STANDALONE_TEST_DEFAULT_NAMESPACE === '1';
const be = await startDisposableStandalone({ defaultNamespace });
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');

async function post(origin: string, urlPath: string, body: unknown) {
  const res = await fetch(`${origin}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const randomNonce = () => crypto.randomBytes(16).toString('base64url');

async function claimTestIdentity(origin: string, username: string, secret: string, rootNamespace: string) {
  const namespace = `${username}.${rootNamespace}`;
  const branchSeed = await deriveBranchProofSeed(secret, username);
  const { privateKey, publicKey } = await importEd25519SigningKey(branchSeed);
  const publicKeyRaw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
  const timestamp = Date.now();
  const proofMessage = normalizeProofMessage({ identityHash: username, expression: username, namespace, rootNamespace, challenge: null, timestamp });
  const claimRes = await post(origin, '/', {
    operation: 'claim', namespace, secret, identityHash: username,
    proof: { message: proofMessage, signature: await signEd25519Proof(privateKey, proofMessage), publicKey: publicKeyRaw, timestamp },
  });
  if (claimRes.status !== 201) throw new Error(`claim ${username}: ${claimRes.status} ${JSON.stringify(claimRes.json)}`);
  return { namespace, identityHash: username, sign: (m: string) => signEd25519Proof(privateKey, m) };
}
async function generateDeviceKey() {
  const { privateKey, publicKey } = await importEd25519SigningKey(new Uint8Array(crypto.randomBytes(32)));
  return {
    publicKeyRaw: Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url'),
    sign: (m: string) => signEd25519Proof(privateKey, m),
  };
}
async function registerFirstKeychainKey(origin: string, identity: any, key: any, label: string) {
  const nonce = randomNonce(); const timestamp = Date.now();
  const newKey = { publicKey: key.publicKeyRaw, label };
  const signature = await identity.sign(normalizeProofMessage({ op: 'keychain-register', namespace: identity.namespace, newKey, nonce, timestamp, identityHash: identity.identityHash }));
  const res = await post(origin, '/api/v1/keychain/keys', { namespace: identity.namespace, identityHash: identity.identityHash, newKey, nonce, timestamp, signature });
  if (res.status !== 201) throw new Error(`keychain ${identity.identityHash}: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.key.keyId as string;
}

try {
  // ── the proof, and the refusal to write without it ───────────────────────────
  await be.assertDisposable();
  {
    const wrong = await import('./helpers/standaloneBackend.ts');
    assert.ok(wrong.PROXY_ENTRY.endsWith('Netget-REACT/backend/proxy.js'), 'the entry under test is the real proxy.js');
    // something else that answers like a backend, on another port: it is neither started by this run nor does it carry the
    // marker, so it would never pass for the disposable one (the proof reads who owns the port and what it answers)
    const imposter = (await import('node:http')).createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ namespace: 'localhost' })); });
    await new Promise<void>((r) => imposter.listen(0, '127.0.0.1', () => r()));
    const imposterPort = (imposter.address() as any).port;
    const answer: any = await (await fetch(`http://127.0.0.1:${imposterPort}/main-server-namespace`)).json();
    assert.ok(defaultNamespace || answer.namespace !== be.marker, 'an ambient backend does not carry this run\'s marker');
    const { execFileSync } = await import('node:child_process');
    const owner = Number(execFileSync('lsof', ['-nP', `-iTCP:${imposterPort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]);
    assert.equal(owner, process.pid, 'the imposter is owned by this test process, not by the child the proof looks for');
    assert.notEqual(owner, be.child.pid);
    imposter.close();
  }

  // ── the monad this entry started: identities, keys, and where the gateway finds them ──
  const monadOrigin = String(await getNetgetMonadOrigin());
  assert.match(monadOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const rootNamespace = be.namespace;
  fs.writeFileSync(path.join(be.dataDir, 'runtime', 'apps.json'), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    apps: {
      'test-surface': { id: 'test-surface', name: 'test-surface', host: '127.0.0.1', port: 0, lastSeenMs: Date.now(), ttlMs: 3_600_000, trust: 'owner', metadata: { namespace: rootNamespace, endpoint: monadOrigin }, tags: [] },
      // a live registered app, so an `app:demo` destination exists
      a: { name: 'monad:demo', kind: 'monad', host: '127.0.0.1', port: 9, ttlMs: 24 * 3600_000, lastSeenMs: Date.now(), trust: 'peer', metadata: { monadName: 'demo' }, exposure: { enabled: true, visibility: 'loopback', network: { allowLoopback: true } } },
    },
  }));

  const alice = await claimTestIdentity(monadOrigin, 'alice', 'alice-secret', rootNamespace);
  const aliceKey = await generateDeviceKey();
  const aliceKeyId = await registerFirstKeychainKey(monadOrigin, alice, aliceKey, "Alice's laptop");
  const bob = await claimTestIdentity(monadOrigin, 'bob', 'bob-secret', rootNamespace);
  const bobKey = await generateDeviceKey();
  const bobKeyId = await registerFirstKeychainKey(monadOrigin, bob, bobKey, "Bob's laptop");

  const claimsPath = getGatewayClaimsPath();
  const writeClaims = (bobScopes: string[], aliceScopes: string[] = ['gateway:read']) => fs.writeFileSync(claimsPath, JSON.stringify({
    gatewayId: 'standalone-gate-test.local', owner: alice.identityHash,
    admins: { [alice.identityHash]: true, [bob.identityHash]: true },
    grants: { [alice.identityHash]: aliceScopes, [bob.identityHash]: bobScopes },
    pubkeys: {}, usernames: { [alice.identityHash]: 'alice', [bob.identityHash]: 'bob' },
  }, null, 2));
  writeClaims(['gateway:read']);

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const forged = { 'x-netget-identity': alice.identityHash, 'x-netget-scopes': JSON.stringify(['gateway:write']) };
  const signIn = async (who: any, key: any, keyId: string): Promise<string> => {
    const challenge: any = await (await be.send('POST', '/admin-session/challenge', { identityHash: who.identityHash })).json();
    assert.equal(challenge.ok, true, JSON.stringify(challenge));
    const signature = await key.sign(challenge.challenge);
    const verified: any = await (await be.send('POST', '/admin-session/verify', { identityHash: who.identityHash, namespace: who.namespace, keyId, signature })).json();
    assert.equal(verified.ok, true, JSON.stringify(verified));
    return verified.sessionToken as string;
  };
  const ownerToken = await signIn(alice, aliceKey, aliceKeyId);
  const readerToken = await signIn(bob, bobKey, bobKeyId);
  const listed = async (headers: Record<string, string> = {}) => ((await (await be.send('GET', '/domains', undefined, headers)).json()) as any).domains as any[];
  const names = async () => (await listed()).map((d) => d.domain).sort();
  const add = (headers: Record<string, string>, body: Record<string, unknown>) => be.send('POST', '/add-domain', body, headers);

  // ── anonymous: refused, whatever else is sent ────────────────────────────────
  const anonymousHeaders: Array<Record<string, string>> = [{}, forged, { authorization: 'Bearer nobody' }, { ...forged, authorization: 'Bearer nobody' }];
  for (const headers of anonymousHeaders) {
    const r = await add(headers, { domain: 'anon.test', type: 'server', target: '127.0.0.1:4000' });
    assert.equal(r.status, 401, 'an anonymous add is refused');
    assert.equal(((await r.json()) as any).error, 'ADMIN_SESSION_REQUIRED');
  }
  for (const [method, p, body] of [
    ['POST', '/update-domain', { domain: 'x.test', updatedFields: { target: '127.0.0.1:4000' } }],
    ['POST', '/delete-domain', { domain: 'x.test' }],
    ['POST', '/provision-cert', { domain: 'x.test' }],
    ['POST', '/domains/metadata', { domain: 'x.test' }],
    ['POST', '/openresty-restart', {}],
    ['POST', '/openresty-stop', {}],
    ['POST', '/frontend-mode', { mode: 'package-dist' }],
    ['POST', '/__gateway/claim', {}],
    ['POST', '/apps/report', { name: 'x', host: '127.0.0.1', port: 1 }],
    ['GET', '/domains/status', undefined],
  ] as const) {
    const r = await be.send(method, p, body);
    assert.equal(r.status, 401, `${method} ${p} is refused to an anonymous caller`);
  }
  assert.deepEqual(await names(), [], 'nothing was written');

  // public reads stay public; the public view carries no target
  for (const p of ['/gateway-identity', '/main-server-namespace', '/domains', '/healthcheck']) assert.equal((await be.send('GET', p)).status, 200, p);
  assert.equal(((await (await be.send('GET', '/main-server-namespace')).json()) as any).namespace, rootNamespace);

  // the routes that authenticate themselves are not answered by the gate's credential
  const gateError = (b: any) => b?.error === 'ADMIN_SESSION_REQUIRED' || b?.error === 'CAPABILITY_DENIED';
  for (const [method, p, body] of [['POST', '/setup/verify-code', { code: 'nope' }], ['POST', '/admin-session/challenge', { identityHash: 'nobody' }],
    ['POST', '/gateway-admin/grant', {}], ['GET', '/openresty/install/availability', undefined], ['GET', '/openresty/install/progress', undefined]] as const) {
    const r = await be.send(method, p, body);
    assert.equal(gateError(await r.json().catch(() => null)), false, `${method} ${p} is answered by its own route, not by the gate`);
  }
  assert.equal((await be.send('GET', '/logs')).status, 401);

  // ── a read-only admin: reads the configuration, refused the writes, the answer names what is missing ──
  assert.equal((await add(bearer(ownerToken), { domain: 'svc.test', type: 'server', target: '127.0.0.1:4000' })).status, 200, 'owner connects');
  assert.deepEqual(await names(), ['svc.test']);
  const publicRow = (await listed())[0];
  assert.deepEqual(Object.keys(publicRow).sort(), ['domain', 'tlsConfigured', 'type'].sort(), 'the anonymous view is the allow-list');
  assert.equal((await listed(bearer(readerToken)))[0].target, '127.0.0.1:4000', 'a read-only admin reads the configuration');
  assert.equal((await listed(bearer(ownerToken)))[0].target, '127.0.0.1:4000');
  const denied = await add(bearer(readerToken), { domain: 'bob.test', type: 'server', target: '127.0.0.1:4001' });
  assert.equal(denied.status, 403);
  const deniedBody: any = await denied.json();
  assert.equal(deniedBody.error, 'CAPABILITY_DENIED'); assert.equal(deniedBody.required, 'gateway:write');
  assert.equal((await add({ ...bearer(readerToken), ...forged }, { domain: 'bob-forged.test', type: 'server', target: '127.0.0.1:4001' })).status, 403, 'forged identity headers add nothing');
  assert.equal((await be.send('POST', '/delete-domain', { domain: 'svc.test' }, bearer(readerToken))).status, 403);
  assert.equal((await be.send('GET', '/domains/status', undefined, bearer(readerToken))).status, 403);
  assert.deepEqual(await names(), ['svc.test']);

  // ── connect -> change destination -> disconnect, as the owner ────────────────
  const status = (await (await be.send('GET', '/domains/status', undefined, bearer(ownerToken))).json()) as any;
  assert.equal(status.statuses.find((s: any) => s.domain === 'svc.test').target, '127.0.0.1:4000');
  const update = (body: Record<string, unknown>, headers = bearer(ownerToken)) => be.send('POST', '/update-domain', { domain: 'svc.test', updatedFields: body }, headers);
  assert.equal((await update({ type: 'server', target: 'app:demo' })).status, 200, 'to a registered app');
  assert.equal((await listed(bearer(ownerToken)))[0].target, 'app:demo');
  const folder = fs.mkdtempSync(path.join(be.tmp, 'site-'));
  assert.equal((await update({ type: 'static', target: folder })).status, 200, 'to a folder');
  assert.equal((await listed(bearer(ownerToken)))[0].type, 'static');
  const refused = await update({ type: 'server', target: '127.0.0.1:3000' });
  assert.equal(refused.status, 400, 'a destination the validation refuses');
  assert.equal(((await refused.json()) as any).code, 'GATEWAY_PORT');
  assert.equal((await listed(bearer(ownerToken)))[0].type, 'static', 'the refused change did not apply');
  assert.equal((await be.send('POST', '/update-domain', { domain: 'absent.test', updatedFields: { type: 'server', target: '127.0.0.1:4000' } }, bearer(ownerToken))).status, 404);
  assert.equal((await be.send('POST', '/delete-domain', { domain: 'svc.test' }, bearer(ownerToken))).status, 200);
  assert.deepEqual(await names(), [], 'disconnected');

  // ── a grant is read fresh on every call, and so is taking it back ────────────
  writeClaims(['gateway:read', 'gateway:write']);
  assert.equal((await add(bearer(readerToken), { domain: 'bob.test', type: 'server', target: '127.0.0.1:4001' })).status, 200, 'the same session may write once granted');
  assert.deepEqual(await names(), ['bob.test']);
  writeClaims(['gateway:read']);
  assert.equal((await add(bearer(readerToken), { domain: 'bob-again.test', type: 'server', target: '127.0.0.1:4001' })).status, 403, 'and not after it is taken back');
  assert.equal((await be.send('POST', '/delete-domain', { domain: 'bob.test' }, bearer(ownerToken))).status, 200);
  assert.deepEqual(await names(), []);

  // ── the installation's root, bound to ITS monad's identity, and the only shape a wildcard may take ──
  {
    const { readMonadRecord } = await import('monad.ai');
    const record: any = await readMonadRecord(be.monadName);
    assert.ok(record?.identity_hash, "the disposable monad has an identity");
    assert.equal(
      (await be.send('POST', '/add-domain', { domain: '*.casa.test', type: 'server', target: 'app:demo' }, bearer(ownerToken))).status, 200,
      'an operator may declare a wildcard route (the same gate as any route)');
    for (const bad of ['*', 'a*.casa.test', '*.*.casa.test', 'casa.*']) {
      const r = await be.send('POST', '/add-domain', { domain: bad, type: 'server', target: 'app:demo' }, bearer(ownerToken));
      assert.equal(r.status, 400, `${bad} is not a wildcard route`);
      assert.equal(((await r.json()) as any).code, 'WILDCARD_SHAPE');
    }
    const map = JSON.parse(fs.readFileSync(path.join(be.dataDir, 'runtime', 'domain-map.json'), 'utf8'));
    assert.deepEqual(map.roots, { [be.namespace]: { app: be.monadName, identity: record.identity_hash, source: 'installation' } },
      "the projection authorizes the installation's own root, bound to its monad's identity, and nothing an announcement could add");
    assert.ok(map.domains['*.casa.test'], 'the wildcard is projected as a route');
    assert.equal((await be.send('POST', '/delete-domain', { domain: '*.casa.test' }, bearer(ownerToken))).status, 200);
  }

  // ── a second capability, on top of the gate: gateway:write:domain-metadata ───
  // Being let in by the gate (gateway:write) is not being granted this write: two checks, on purpose.
  assert.equal((await add(bearer(ownerToken), { domain: 'meta.test', type: 'server', target: '127.0.0.1:4000' })).status, 200);
  const meta = (headers: Record<string, string>) => be.send('POST', '/domains/metadata', { domain: 'meta.test', description: 'una descripción' }, headers);
  const noScope = await meta(bearer(ownerToken));
  assert.equal(noScope.status, 403, 'the owner passes the gate and still lacks the metadata capability');
  assert.equal(((await noScope.json()) as any).required, 'gateway:write:domain-metadata');
  writeClaims(['gateway:read', 'gateway:write:domain-metadata'], ['gateway:read', 'gateway:write:domain-metadata']);
  assert.equal((await meta(bearer(ownerToken))).status, 200, 'granted, the owner may');
  const readerWithMeta = await meta(bearer(readerToken));
  assert.equal(readerWithMeta.status, 403, 'the metadata capability without gateway:write is stopped by the gate first');
  assert.equal(((await readerWithMeta.json()) as any).required, 'gateway:write');
  assert.equal((await meta({})).status, 401);
  const metaFile = path.join(be.dataDir, 'runtime', 'domain-metadata.json');
  assert.ok(fs.existsSync(metaFile) && fs.readFileSync(metaFile, 'utf8').includes('una descripción'), 'written under the disposable data dir');
  assert.equal((await be.send('POST', '/delete-domain', { domain: 'meta.test' }, bearer(ownerToken))).status, 200);
  writeClaims(['gateway:read']);

  // ── the machine's own gateway was not touched ───────────────────────────────
  assert.deepEqual(realFiles.map(mtimeOf), realBefore, "none of the machine's own gateway files (map, metadata, audit log, claims) was written by this run");
  assert.equal(mtimeOf(realMapPath), realMapBefore);
  assert.ok(be.dataDir.startsWith(os.tmpdir()) || be.dataDir.includes('netget-standalone-'), 'the data dir is a temp dir');
} finally {
  await be.stop();
}
console.log('standalone-backend-gate: ok');
process.exit(0);
