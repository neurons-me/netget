/**
 * nginx-fronted-gate.test.ts -- the path the operator actually uses: a browser or a CLI -> OpenResty -> the standalone
 * backend. Everything is disposable and built from the sources of the tree this runs from:
 *
 *   OpenResty   from the generator's main conf and app conf (tests/helpers/disposableOpenResty.ts), loopback high ports
 *   backend     THE entry point, proxy.js, as a child process (tests/helpers/standaloneBackend.ts), its own monad and data
 *   identities  claimed in that monad, signed in through nginx with the gateway's own challenge/verify flow
 *
 * Checked THROUGH nginx: the anonymous refusals survive the proxy; identity and internal-credential headers a client
 * sends are worth nothing (the request comes from loopback, which is not trust); an administrator obtains a session by the
 * existing flow and is let in, a read-only one is refused naming the capability; connect -> change destination ->
 * disconnect; the front end is served; and the configuration that is LOADED names no directory that does not exist (the
 * defect that left the real gateway reading a deleted test directory).
 * Refuses to write unless the backend has proven it is the disposable one (standaloneBackend.assertDisposable).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { findOpenResty, startDisposableOpenResty } = await import('./helpers/disposableOpenResty.ts');
if (!findOpenResty()) { console.log('nginx-fronted-gate: skipped (no openresty on this machine)'); process.exit(0); }

const REAL = path.join(os.homedir(), '.get');
const realFiles = ['runtime/domain-map.json', 'runtime/domain-metadata.json', 'runtime/audit.log', 'runtime/gateway-claims.json', 'xConfig.json']
  .map((f) => path.join(REAL, f));
const mtimeOf = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null);
const realBefore = realFiles.map(mtimeOf);

const { startDisposableStandalone } = await import('./helpers/standaloneBackend.ts');
const { claimIdentityWithKey, signInThrough, writeGatewayClaims, writeAppsRegistry } = await import('./helpers/testIdentities.ts');

const defaultNamespace = process.env.STANDALONE_TEST_DEFAULT_NAMESPACE === '1';
const be = await startDisposableStandalone({ defaultNamespace });
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');
const { getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');

// The front end nginx serves: a build handed in (NGINX_TEST_UI_ROOT), or a tiny one made here, so the test does not depend on
// a build being present in the tree (the built dist is not in git).
let uiRoot = process.env.NGINX_TEST_UI_ROOT || '';
if (!uiRoot) {
  uiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-ui-'));
  fs.mkdirSync(path.join(uiRoot, 'assets'));
  fs.writeFileSync(path.join(uiRoot, 'assets', 'index-test0001.js'), 'console.log("ui")\n');
  fs.writeFileSync(path.join(uiRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-test0001.js"></script></body></html>\n');
}
const luaRoot = path.resolve(here, '../src/modules/NetGetX/OpenResty/lua');
let ng: Awaited<ReturnType<typeof startDisposableOpenResty>> | null = null;

try {
  // NGINX_TEST_INSTALLED=1: put in front what is INSTALLED on this machine (its conf.d/netget_app.conf and its Lua tree,
  // read, never written) instead of what the generator writes for this tree.
  const installed = process.env.NGINX_TEST_INSTALLED === '1';
  const installedApp = '/opt/homebrew/etc/openresty/conf.d/netget_app.conf';
  ng = await startDisposableOpenResty({
    backendPort: be.port, uiRoot,
    ...(installed ? { appConfText: fs.readFileSync(installedApp, 'utf8') } : { luaRoot }),
  });
  const via = async (method: string, urlPath: string, body?: unknown, headers: Record<string, string> = {}) => {
    // a write goes to the backend only after it proved it is the disposable one
    if (method !== 'GET' && method !== 'HEAD') await be.assertDisposable();
    return fetch(`${ng!.origin}${urlPath}`, {
      method, redirect: 'manual',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  const json = async (r: Response) => (await r.json().catch(() => null)) as any;

  // ── nginx really is in front of THIS backend ─────────────────────────────────
  const ns: any = await json(await via('GET', '/main-server-namespace'));
  assert.equal(ns.namespace, be.namespace, 'the admin block proxies to the disposable backend');

  // ── the configuration that is loaded names nothing that does not exist ───────
  const loaded = `${ng.mainConf}\n${ng.appConf}`;
  assert.ok(!/netget-nginxsync/.test(loaded), 'no leftover test directory in the loaded configuration');
  const named = new Set<string>();
  for (const m of loaded.matchAll(/["' ;=](\/(?:Users|var\/folders|private\/var|tmp)\/[^"'\s;]+)/g)) named.add(m[1].replace(/[),]+$/, ''));
  const mayBeMissing = (p: string) => /\/runtime\/(domain-map\.json|domain-map\.version|apps\.json)$|\/domains\.db$|\/(html|certs)(\/|$)|\.pem$|\/NetgetErrorCodeHandler\.html$/.test(p);
  // `?` is a Lua search pattern (lua_package_path), not a file
  const missing = [...named].filter((p) => !p.includes('?') && !fs.existsSync(p) && !mayBeMissing(p) && !p.startsWith(ng!.dir));
  assert.deepEqual(missing, [], `every absolute path the loaded configuration names exists: ${missing.join(', ')}`);
  assert.ok(loaded.includes(be.dataDir), 'it reads the data directory it was started with');

  // ── the front end is what nginx serves ───────────────────────────────────────
  const index = await via('GET', '/', undefined, { accept: 'text/html' });
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /<div id="root"/);
  const entry = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  assert.ok(entry && (await via('GET', `/${entry}`)).status === 200, 'its entry script is served');

  // ── identities and the existing sign-in flow, THROUGH nginx ──────────────────
  const monadOrigin = String(await getNetgetMonadOrigin());
  writeAppsRegistry(path.join(be.dataDir, 'runtime'), be.namespace, monadOrigin);
  const alice = await claimIdentityWithKey(monadOrigin, 'alice', 'alice-secret', be.namespace);
  const bob = await claimIdentityWithKey(monadOrigin, 'bob', 'bob-secret', be.namespace);
  const claimsPath = getGatewayClaimsPath();
  const grant = (bob: string[]) => writeGatewayClaims(claimsPath, 'nginx-fronted-gate.local', alice.identityHash, { [alice.identityHash]: ['gateway:read'], [bob_id]: bob });
  const bob_id = bob.identityHash;
  grant(['gateway:read']);

  const viaPost = async (urlPath: string, body: unknown) => {
    const res = await via('POST', urlPath, body);
    return { status: res.status, json: await json(res) };
  };
  const signInViaNginx = async (who: typeof alice) => {
    const c = await viaPost('/admin-session/challenge', { identityHash: who.identityHash });
    assert.equal(c.json?.ok, true, `challenge through nginx: ${JSON.stringify(c)}`);
    const v = await viaPost('/admin-session/verify', { identityHash: who.identityHash, namespace: who.namespace, keyId: who.keyId, signature: await who.sign(c.json.challenge) });
    assert.equal(v.json?.ok, true, `verify through nginx: ${JSON.stringify(v)}`);
    return v.json.sessionToken as string;
  };
  const ownerToken = await signInViaNginx(alice);
  const readerToken = await signInViaNginx(bob);
  assert.ok(ownerToken && readerToken && ownerToken !== readerToken, 'each administrator got a session of its own');

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const names = async () => ((await json(await via('GET', '/domains'))).domains as any[]).map((d) => d.domain).sort();
  const add = (headers: Record<string, string>, domain: string) => via('POST', '/add-domain', { domain, type: 'server', target: '127.0.0.1:4000' }, headers);

  // ── the anonymous refusals survive the proxy; loopback is not trust ──────────
  const forgedIdentity = { 'x-netget-identity': alice.identityHash, 'x-netget-scopes': JSON.stringify(['gateway:write', 'gateway:write:domain-metadata']) };
  const forgedInternal = { 'x-monad-internal-token': 'anything', 'x-internal-token': 'anything' };
  const forgedPeer = { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1' };
  const hostile: Array<Record<string, string>> = [{}, forgedIdentity, forgedInternal, forgedPeer, { ...forgedIdentity, ...forgedInternal, ...forgedPeer, authorization: 'Bearer nobody' }];
  for (const headers of hostile) {
    for (const [method, p, body] of [
      ['POST', '/add-domain', { domain: 'anon.test', type: 'server', target: '127.0.0.1:4000' }],
      ['POST', '/update-domain', { domain: 'anon.test', updatedFields: { target: '127.0.0.1:4001' } }],
      ['POST', '/delete-domain', { domain: 'anon.test' }],
      ['POST', '/domains/metadata', { domain: 'anon.test', description: 'x' }],
      ['POST', '/openresty-stop', {}],
      ['POST', '/__gateway/claim', {}],
    ] as const) {
      const r = await via(method, p, body, headers);
      // 401/403: the backend's gate; 405: nginx's own method list for that location. Either way, nothing was done.
      assert.ok([401, 403, 405].includes(r.status), `${method} ${p} refused through nginx with ${Object.keys(headers).join(',') || 'no headers'} (got ${r.status})`);
    }
  }
  assert.deepEqual(await names(), [], 'nothing was written by an anonymous or forged request');
  // public reads stay public, and the public view carries no wiring
  for (const p of ['/gateway-identity', '/main-server-namespace', '/healthcheck', '/domains']) assert.equal((await via('GET', p)).status, 200, p);

  // ── an authorized operator, through nginx ────────────────────────────────────
  assert.equal((await add(bearer(ownerToken), 'svc.test')).status, 200, 'the owner connects');
  assert.deepEqual(await names(), ['svc.test']);
  assert.deepEqual(Object.keys((await json(await via('GET', '/domains'))).domains[0]).sort(), ['domain', 'tlsConfigured', 'type'].sort(), 'anonymous view = allow-list');
  const full = (await json(await via('GET', '/domains', undefined, bearer(readerToken)))).domains[0];
  assert.equal(full.target, '127.0.0.1:4000', 'a read-only administrator reads the configuration');
  const status = await via('GET', '/domains/status', undefined, bearer(ownerToken));
  assert.equal(status.status, 200);
  assert.equal((await json(status)).statuses[0].target, '127.0.0.1:4000');

  const denied = await add(bearer(readerToken), 'bob.test');
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).required, 'gateway:write');
  assert.equal((await add({ ...bearer(readerToken), ...forgedIdentity }, 'bob-forged.test')).status, 403, 'a forged identity does not lift a read-only session');
  assert.deepEqual(await names(), ['svc.test']);

  const update = (updatedFields: Record<string, unknown>) => via('POST', '/update-domain', { domain: 'svc.test', updatedFields }, bearer(ownerToken));
  assert.equal((await update({ type: 'server', target: 'app:demo' })).status, 200);
  const folder = fs.mkdtempSync(path.join(be.tmp, 'site-'));
  assert.equal((await update({ type: 'static', target: folder })).status, 200);
  const refused = await update({ type: 'server', target: '127.0.0.1:3000' });
  assert.equal(refused.status, 400);
  assert.equal((await json(refused)).code, 'GATEWAY_PORT');
  assert.equal((await via('POST', '/delete-domain', { domain: 'svc.test' }, bearer(ownerToken))).status, 200);
  assert.deepEqual(await names(), [], 'disconnected');

  // a grant is read fresh through the proxy too, and taking it back refuses the same session again
  grant(['gateway:read', 'gateway:write']);
  assert.equal((await add(bearer(readerToken), 'bob.test')).status, 200);
  grant(['gateway:read']);
  assert.equal((await add(bearer(readerToken), 'bob-again.test')).status, 403);
  assert.equal((await via('POST', '/delete-domain', { domain: 'bob.test' }, bearer(ownerToken))).status, 200);
  assert.deepEqual(await names(), []);

  // ── what nginx itself logged, and what it did not touch ──────────────────────
  const errorLog = ng.errorLogPaths.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')).join('\n');
  const fileErrors = errorLog.split('\n').filter((l) => /open\(\) .* failed \(2: No such file or directory\)|failed to load|attempt to/.test(l));
  assert.deepEqual(fileErrors, [], 'the loaded configuration did not fail to open anything');
  assert.deepEqual(realFiles.map(mtimeOf), realBefore, "none of the machine's own gateway files was written");
} finally {
  if (ng) await ng.stop();
  await be.stop();
  if (!process.env.NGINX_TEST_UI_ROOT) fs.rmSync(uiRoot, { recursive: true, force: true });
}
console.log('nginx-fronted-gate: ok');
process.exit(0);
