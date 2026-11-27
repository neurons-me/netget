// Server-side Facebook code exchange. Graph is mocked; nothing is sent to facebook.com.
import assert from 'node:assert/strict';
import {
  exchangeFacebookCodeWithEnv,
  publicFacebookAppPayload,
  publicAppIdFromTreeValue,
  readPublicMetaAppIdFromTree,
  resolveMetaAppCredentials,
  FACEBOOK_GRAPH,
  META_APP_ID_ENV,
  META_APP_SECRET_ENV,
  NAMESPACE_META_APP_ID_PATH,
  isAllowedFacebookRedirect,
  defaultFacebookRedirectAllowlist,
  parseFacebookExchangeBody,
  normalizeFacebookRedirect,
  facebookCorsAllowedOrigin,
} from '../src/gateway/facebookExchange.ts';

const PREV_ID = process.env[META_APP_ID_ENV];
const PREV_SECRET = process.env[META_APP_SECRET_ENV];

const TEST_ID = '123456789';
const TEST_SECRET = 'test-app-secret-not-real';
const TREE_ID = '999888777';
const SHORT = 'short-token-for-tests';
const LONG = 'long-token-for-tests';

function restoreEnv() {
  if (PREV_ID === undefined) delete process.env[META_APP_ID_ENV];
  else process.env[META_APP_ID_ENV] = PREV_ID;
  if (PREV_SECRET === undefined) delete process.env[META_APP_SECRET_ENV];
  else process.env[META_APP_SECRET_ENV] = PREV_SECRET;
}

function mockGraph(plan: Array<{ match: (u: URL) => boolean; body: unknown; status?: number }>) {
  const calls: { url: string }[] = [];
  const run = async (url: string) => {
    calls.push({ url });
    const u = new URL(url);
    assert.equal(u.hostname, 'graph.facebook.com');
    const hit = plan.find((p) => p.match(u));
    assert.ok(hit, `unexpected graph url path ${u.pathname} search ${u.search}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { run, calls };
}

const logs: string[] = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
const origInfo = console.info;
const spy = (...args: unknown[]) => { logs.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); origLog(...args); };
console.log = spy;
console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };

try {
  delete process.env[META_APP_ID_ENV];
  delete process.env[META_APP_SECRET_ENV];
  const missing = await publicFacebookAppPayload();
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, 503);
    assert.equal(missing.message, 'Facebook connect is not available.');
  }

  process.env[META_APP_ID_ENV] = TEST_ID;
  process.env[META_APP_SECRET_ENV] = TEST_SECRET;
  const pub = await publicFacebookAppPayload();
  assert.equal(pub.ok, true);
  if (pub.ok) assert.equal(pub.appId, TEST_ID);
  assert.ok(!JSON.stringify(pub).toLowerCase().includes('secret'));

  const { run, calls } = mockGraph([
    {
      match: (u) => u.pathname.endsWith('/oauth/access_token') && !u.searchParams.get('grant_type'),
      body: { access_token: SHORT, expires_in: 3600 },
    },
    {
      match: (u) => u.searchParams.get('grant_type') === 'fb_exchange_token',
      body: { access_token: LONG, expires_in: 5184000 },
    },
  ]);

  const out = await exchangeFacebookCodeWithEnv({
    code: 'the-code',
    redirectUri: 'https://cleaker.me/oauth/callback',
    verifier: 'ver',
    now: Date.parse('2026-11-15T22:00:00-06:00'),
    fetch: run,
  });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.token, LONG);
    assert.equal(out.expires, '2027-01-15');
  }
  assert.ok(calls.every((c) => new URL(c.url).hostname === 'graph.facebook.com'));
  assert.ok(calls.every((c) => c.url.startsWith(`${FACEBOOK_GRAPH}/`)));
  assert.ok(!JSON.stringify(out).includes(TEST_SECRET));

  const refused = await exchangeFacebookCodeWithEnv({
    code: '',
    redirectUri: 'https://cleaker.me/oauth/callback',
    verifier: 'ver',
    fetch: run,
  });
  assert.equal(refused.ok, false);

  // Tree public App ID wins over env. Secret stays the env one (never from the tree).
  const treePub = await publicFacebookAppPayload(async () => TREE_ID);
  assert.equal(treePub.ok, true);
  if (treePub.ok) assert.equal(treePub.appId, TREE_ID);
  assert.ok(!JSON.stringify(treePub).toLowerCase().includes('secret'));

  const creds = await resolveMetaAppCredentials(async () => TREE_ID);
  assert.ok(creds);
  assert.equal(creds?.appId, TREE_ID);
  assert.equal(creds?.appIdSource, 'tree');
  assert.equal(creds?.appSecret, TEST_SECRET);

  const treeGraph = mockGraph([
    { match: (u) => u.searchParams.get('code') === 'ok' && u.searchParams.get('client_id') === TREE_ID, body: { access_token: SHORT, expires_in: 3600 } },
    { match: (u) => u.searchParams.get('grant_type') === 'fb_exchange_token' && u.searchParams.get('client_id') === TREE_ID, body: { access_token: LONG, expires_in: 5184000 } },
  ]);
  const fromTree = await exchangeFacebookCodeWithEnv({
    code: 'ok',
    redirectUri: 'https://cleaker.me/oauth/callback',
    verifier: 'verifier-value',
    now: Date.parse('2026-11-15T22:00:00-06:00'),
    fetch: treeGraph.run,
    readAppIdFromTree: async () => TREE_ID,
  });
  assert.equal(fromTree.ok, true);
  assert.ok(treeGraph.calls.every((c) => new URL(c.url).searchParams.get('client_id') === TREE_ID));
  assert.ok(treeGraph.calls.every((c) => new URL(c.url).searchParams.get('client_secret') === TEST_SECRET));
  assert.ok(!JSON.stringify(fromTree).includes(TEST_SECRET));

  // A reader that returns nothing (or throws) falls back to env.
  const envPub = await publicFacebookAppPayload(async () => null);
  assert.equal(envPub.ok, true);
  if (envPub.ok) assert.equal(envPub.appId, TEST_ID);
  const threwPub = await publicFacebookAppPayload(async () => { throw new Error('no tree yet'); });
  assert.equal(threwPub.ok, true);
  if (threwPub.ok) assert.equal(threwPub.appId, TEST_ID);

  // No tree and no env: refused, and the mocked graph is not called.
  delete process.env[META_APP_ID_ENV];
  delete process.env[META_APP_SECRET_ENV];
  const noCalls = mockGraph([]);
  const none = await exchangeFacebookCodeWithEnv({
    code: 'ok',
    redirectUri: 'https://cleaker.me/oauth/callback',
    verifier: 'verifier-value',
    fetch: noCalls.run,
    readAppIdFromTree: async () => null,
  });
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.equal(none.status, 503);
    assert.equal(none.message, 'Facebook connect is not available.');
  }
  assert.equal(noCalls.calls.length, 0);

  // Tree id without a secret is not enough to exchange.
  process.env[META_APP_ID_ENV] = TEST_ID;
  delete process.env[META_APP_SECRET_ENV];
  const idOnly = await exchangeFacebookCodeWithEnv({
    code: 'ok',
    redirectUri: 'https://cleaker.me/oauth/callback',
    verifier: 'verifier-value',
    fetch: noCalls.run,
    readAppIdFromTree: async () => TREE_ID,
  });
  assert.equal(idOnly.ok, false);
  if (!idOnly.ok) assert.equal(idOnly.status, 503);

  // The tree reader only takes a public id; an object may have id, never secret.
  assert.equal(publicAppIdFromTreeValue(TREE_ID), TREE_ID);
  assert.equal(publicAppIdFromTreeValue({ id: TREE_ID, secret: 'should-be-ignored' }), TREE_ID);
  assert.equal(publicAppIdFromTreeValue({ secret: 'x' }), null);
  assert.equal(publicAppIdFromTreeValue('not-digits'), null);

  const seenPaths: string[] = [];
  const treeId = await readPublicMetaAppIdFromTree({
    origin: 'http://127.0.0.1:1',
    namespace: 'cleaker.me',
    read: async (_origin, _ns, path) => {
      seenPaths.push(path);
      return { value: TREE_ID, path };
    },
  });
  assert.equal(treeId, TREE_ID);
  assert.deepEqual(seenPaths, [NAMESPACE_META_APP_ID_PATH]);

  // Redirect allowlist: exact cleaker.me paths only; no wildcards, no other hosts.
  const allow = defaultFacebookRedirectAllowlist();
  assert.ok(isAllowedFacebookRedirect('https://cleaker.me/oauth/callback', allow));
  assert.ok(isAllowedFacebookRedirect('https://cleaker.me/', allow));
  assert.equal(isAllowedFacebookRedirect('https://cleaker.me/oauth/callback?x=1', allow), false);
  assert.equal(isAllowedFacebookRedirect('https://evil.example/oauth/callback', allow), false);
  assert.equal(isAllowedFacebookRedirect('https://cleaker.me.evil.example/oauth/callback', allow), false);
  assert.equal(isAllowedFacebookRedirect('https://*.cleaker.me/oauth/callback', allow), false);
  assert.equal(normalizeFacebookRedirect('https://cleaker.me/other'), null);
  assert.equal(facebookCorsAllowedOrigin('https://cleaker.me', allow), 'https://cleaker.me');
  assert.equal(facebookCorsAllowedOrigin('https://evil.example', allow), null);
  assert.equal(facebookCorsAllowedOrigin('*', allow), null);

  const parsed = parseFacebookExchangeBody({ code: 'c', redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'v' });
  assert.equal(parsed.ok, true);
  const extra = parseFacebookExchangeBody({ code: 'c', redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'v', extra: 'no' });
  assert.equal(extra.ok, false);

  assert.ok(!logs.some((line) => line.includes(TEST_SECRET)), 'secret must not appear in logs');

  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  console.info = origInfo;
  origLog('facebook-exchange: ok');
} finally {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  console.info = origInfo;
  restoreEnv();
}
