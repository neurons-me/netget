// HTTP routes for Facebook connect. Graph is mocked. Listens on port 0 (never 3000/5320/80/443).
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createFacebookRouter } from '../src/gateway/facebookRoutes.ts';
import { mountGatewayRouters } from '../src/gateway/monadModule.mjs';
import { classifyRoute } from '../src/gateway/adminGate.mjs';
import {
  FACEBOOK_APP_PATH,
  FACEBOOK_EXCHANGE_PATH,
  FACEBOOK_JSON_LIMIT_BYTES,
  META_APP_ID_ENV,
  META_APP_SECRET_ENV,
} from '../src/gateway/facebookExchange.ts';

assert.equal(classifyRoute('GET', FACEBOOK_APP_PATH), 'public');
assert.equal(classifyRoute('POST', FACEBOOK_EXCHANGE_PATH), 'public');
assert.equal(classifyRoute('GET', FACEBOOK_EXCHANGE_PATH), 'trusted');

const PREV_ID = process.env[META_APP_ID_ENV];
const PREV_SECRET = process.env[META_APP_SECRET_ENV];
const TEST_ID = '123456789';
const TEST_SECRET = 'test-app-secret-not-real';
const TREE_ID = '999888777';
const ALLOW = ['https://cleaker.me/oauth/callback', 'https://cleaker.me/'];

function restoreEnv() {
  if (PREV_ID === undefined) delete process.env[META_APP_ID_ENV];
  else process.env[META_APP_ID_ENV] = PREV_ID;
  if (PREV_SECRET === undefined) delete process.env[META_APP_SECRET_ENV];
  else process.env[META_APP_SECRET_ENV] = PREV_SECRET;
}

function mockGraph(clientId: string) {
  return async (url: string) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'graph.facebook.com');
    assert.equal(u.searchParams.get('client_id') || u.searchParams.get('client_id'), clientId);
    if (u.searchParams.get('grant_type') === 'fb_exchange_token') {
      return new Response(JSON.stringify({ access_token: 'long-token-for-tests', expires_in: 5184000 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ access_token: 'short-token-for-tests', expires_in: 3600 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
}

const logs: string[] = [];
const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const capture = (...args: unknown[]) => { logs.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); };
console.warn = capture;
console.error = capture;
console.info = capture;
const logAndKeep = (...args: unknown[]) => { capture(...args); orig.log(...args); };
console.log = logAndKeep;

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const srv: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = srv.address();
  assert.ok(addr && typeof addr === 'object');
  const port = addr.port;
  assert.ok(port !== 3000 && port !== 5320 && port !== 80 && port !== 443);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => srv.close((err) => err ? reject(err) : resolve())),
  };
}

try {
  process.env[META_APP_ID_ENV] = TEST_ID;
  process.env[META_APP_SECRET_ENV] = TEST_SECRET;

  const app = express();
  app.use(createFacebookRouter({
    readAppIdFromTree: async () => TREE_ID,
    fetch: mockGraph(TREE_ID),
    now: () => Date.parse('2026-11-15T22:00:00-06:00'),
    allowRedirects: ALLOW,
  }));
  const { base, close } = await listen(app);
  try {
    const appRes = await fetch(`${base}${FACEBOOK_APP_PATH}`, {
      headers: { origin: 'https://cleaker.me', accept: 'application/json' },
    });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.headers.get('access-control-allow-origin'), 'https://cleaker.me');
    const appBody = await appRes.json() as { ok?: boolean; appId?: string };
    assert.equal(appBody.ok, true);
    assert.equal(appBody.appId, TREE_ID);
    assert.ok(!JSON.stringify(appBody).toLowerCase().includes('secret'));
    assert.ok(!JSON.stringify(appBody).includes(TEST_SECRET));

    const missingTree = express();
    missingTree.use(createFacebookRouter({
      readAppIdFromTree: async () => null,
      allowRedirects: ALLOW,
    }));
    // env still set: fallback
    const fallback = await listen(missingTree);
    try {
      const r = await fetch(`${fallback.base}${FACEBOOK_APP_PATH}`);
      assert.equal(r.status, 200);
      assert.equal((await r.json() as { appId?: string }).appId, TEST_ID);
    } finally { await fallback.close(); }

    delete process.env[META_APP_ID_ENV];
    delete process.env[META_APP_SECRET_ENV];
    const noneApp = express();
    noneApp.use(createFacebookRouter({
      readAppIdFromTree: async () => null,
      allowRedirects: ALLOW,
    }));
    const none = await listen(noneApp);
    try {
      const r = await fetch(`${none.base}${FACEBOOK_APP_PATH}`);
      assert.equal(r.status, 503);
      const body = await r.json() as { message?: string };
      assert.equal(body.message, 'Facebook connect is not available.');
    } finally { await none.close(); }

    process.env[META_APP_ID_ENV] = TEST_ID;
    process.env[META_APP_SECRET_ENV] = TEST_SECRET;

    const exchanged = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://cleaker.me' },
      body: JSON.stringify({ code: 'ok', redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'ver' }),
    });
    assert.equal(exchanged.status, 200);
    const exBody = await exchanged.json() as Record<string, unknown>;
    assert.equal(exBody.ok, true);
    assert.equal(exBody.token, 'long-token-for-tests');
    assert.ok(!JSON.stringify(exBody).includes(TEST_SECRET));
    assert.ok(!Object.keys(exBody).some((k) => k.toLowerCase().includes('secret')));

    const badRedirect = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://cleaker.me' },
      body: JSON.stringify({ code: 'ok', redirectUri: 'https://evil.example/oauth/callback', verifier: 'ver' }),
    });
    assert.equal(badRedirect.status, 400);
    assert.ok(!(await badRedirect.text()).includes(TEST_SECRET));

    const getExchange = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, { method: 'GET' });
    assert.equal(getExchange.status, 405);

    const postApp = await fetch(`${base}${FACEBOOK_APP_PATH}`, { method: 'POST' });
    assert.equal(postApp.status, 405);

    const extraField = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://cleaker.me' },
      body: JSON.stringify({ code: 'ok', redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'ver', extra: 'no' }),
    });
    assert.equal(extraField.status, 400);

    const tooBig = 'x'.repeat(FACEBOOK_JSON_LIMIT_BYTES + 32);
    const oversized = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://cleaker.me' },
      body: JSON.stringify({ code: tooBig, redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'ver' }),
    });
    assert.equal(oversized.status, 413);
    assert.ok(!(await oversized.text()).includes(TEST_SECRET));

    const corsDenied = await fetch(`${base}${FACEBOOK_APP_PATH}`, {
      headers: { origin: 'https://evil.example', accept: 'application/json' },
    });
    assert.equal(corsDenied.status, 403);
    assert.equal(corsDenied.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(`${base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://cleaker.me', 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://cleaker.me');
    assert.ok(preflight.headers.get('access-control-allow-origin') !== '*');
  } finally {
    await close();
  }

  // Mounted behind the admin gate: no session required for these two public routes.
  process.env[META_APP_ID_ENV] = TEST_ID;
  process.env[META_APP_SECRET_ENV] = TEST_SECRET;
  const gated = express();
  const fb = createFacebookRouter({
    readAppIdFromTree: async () => TREE_ID,
    fetch: mockGraph(TREE_ID),
    allowRedirects: ALLOW,
  });
  mountGatewayRouters(gated, [fb], { extraOrigins: ['cleaker.me'] });
  const g = await listen(gated);
  try {
    const r = await fetch(`${g.base}${FACEBOOK_APP_PATH}`, { headers: { origin: 'https://cleaker.me' } });
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { appId?: string }).appId, TREE_ID);
    const ex = await fetch(`${g.base}${FACEBOOK_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://cleaker.me' },
      body: JSON.stringify({ code: 'ok', redirectUri: 'https://cleaker.me/oauth/callback', verifier: 'ver' }),
    });
    assert.equal(ex.status, 200);
  } finally { await g.close(); }

  assert.ok(!logs.some((line) => line.includes(TEST_SECRET)), 'secret must not appear in logs');
  console.log = orig.log;
  console.warn = orig.warn;
  console.error = orig.error;
  console.info = orig.info;
  orig.log('facebook-oauth-routes: ok');
} finally {
  console.log = orig.log;
  console.warn = orig.warn;
  console.error = orig.error;
  console.info = orig.info;
  restoreEnv();
}
