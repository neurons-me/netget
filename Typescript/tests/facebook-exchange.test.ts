// Server-side Facebook code exchange. Graph is mocked; nothing is sent to facebook.com.
import assert from 'node:assert/strict';
import {
  exchangeFacebookCodeWithEnv,
  publicFacebookAppPayload,
  FACEBOOK_GRAPH,
  META_APP_ID_ENV,
  META_APP_SECRET_ENV,
} from '../src/gateway/facebookExchange.ts';

const PREV_ID = process.env[META_APP_ID_ENV];
const PREV_SECRET = process.env[META_APP_SECRET_ENV];

const TEST_ID = '123456789';
const TEST_SECRET = 'test-app-secret-not-real';
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

try {
  delete process.env[META_APP_ID_ENV];
  delete process.env[META_APP_SECRET_ENV];
  const missing = await publicFacebookAppPayload();
  assert.equal(missing.ok, false);

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
    redirectUri: 'http://127.0.0.1:59999/oauth/callback',
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
  // secret is present on the graph URL (that's the one allowed destination) but not in the result payload
  assert.ok(!JSON.stringify(out).includes(TEST_SECRET));

  const refused = await exchangeFacebookCodeWithEnv({
    code: '',
    redirectUri: 'http://127.0.0.1:59999/oauth/callback',
    verifier: 'ver',
    fetch: run,
  });
  assert.equal(refused.ok, false);

  console.log('facebook-exchange: ok');

  // Tree credentials win over env when the reader returns a server-readable entry.
  const TREE_ID = 'tree-app-id-999';
  const TREE_SECRET = 'tree-app-secret-not-real';
  const treePub = await publicFacebookAppPayload(async () => ({ appId: TREE_ID, appSecret: TREE_SECRET }));
  assert.equal(treePub.ok, true);
  if (treePub.ok) assert.equal(treePub.appId, TREE_ID);
  assert.ok(!JSON.stringify(treePub).toLowerCase().includes('secret'));

  const treeGraph = mockGraph([
    { match: (u) => u.searchParams.get('code') === 'ok' && u.searchParams.get('client_id') === TREE_ID, body: { access_token: SHORT, expires_in: 3600 } },
    { match: (u) => u.searchParams.get('grant_type') === 'fb_exchange_token' && u.searchParams.get('client_id') === TREE_ID, body: { access_token: LONG, expires_in: 5184000 } },
  ]);
  const fromTree = await exchangeFacebookCodeWithEnv({
    code: 'ok',
    redirectUri: 'https://example.test/oauth/facebook',
    verifier: 'verifier-value',
    now: Date.parse('2026-11-15T22:00:00-06:00'),
    fetch: treeGraph.run,
    readFromTree: async () => ({ appId: TREE_ID, appSecret: TREE_SECRET }),
  });
  assert.equal(fromTree.ok, true);
  assert.ok(treeGraph.calls.every((c) => new URL(c.url).searchParams.get('client_id') === TREE_ID));
  assert.ok(!JSON.stringify(fromTree).includes(TREE_SECRET));
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
    redirectUri: 'https://example.test/oauth/facebook',
    verifier: 'verifier-value',
    fetch: noCalls.run,
    readFromTree: async () => null,
  });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.status, 503);
  assert.equal(noCalls.calls.length, 0);

} finally {
  restoreEnv();
}
