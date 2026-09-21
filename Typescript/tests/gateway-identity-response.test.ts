import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// ONE answer to GET /gateway-identity.
//
// It used to be two: the Express route and a Lua handler behind nginx, with different contracts. On the real gateway
// the same claim read `adminCount: 1` through one door and `0` through the other (Lua left the owner out), the screen
// fed by the Express route could not name its owner (ownerUsername existed only in Lua), and the screens' "this request
// arrived via https:443" (port/scheme) existed only in Lua too. This pins the single contract.

const { buildGatewayIdentityResponse, arrivalOf } = await import('../src/modules/NetGetX/Auth/gatewayIdentityResponse.ts');

const CONTRACT = ['adminCount', 'bootstrapped', 'gatewayId', 'hostname', 'ip', 'owner', 'ownerUsername', 'port', 'scheme', 'scopes', 'updatedAt', 'version'];
const machine = { hostname: 'the-host', ip: '10.0.0.5' };
const https443 = { scheme: 'https' as const, port: 443 };

// ── unclaimed: no snapshot at all ───────────────────────────────────────────
const unclaimed = buildGatewayIdentityResponse(null, https443, machine);
assert.deepEqual(Object.keys(unclaimed).sort(), CONTRACT, 'the whole contract is always there');
assert.deepEqual(unclaimed, {
  gatewayId: 'the-host', hostname: 'the-host', bootstrapped: false, owner: null, ownerUsername: null, adminCount: 0, scopes: [], version: null, updatedAt: null,
  scheme: 'https', port: 443, ip: '10.0.0.5',
});

// ── claimed: the shape of the real snapshot (materialized from the monad's authority) ──
const OWNER = 'd1fec56cd40fbadd0fb23cb4a0090ca5f9ea51e1f102e2e28463a6469a006bfb';
const claimed = buildGatewayIdentityResponse({
  gatewayId: '5f5a2602c5b1707b243e3fa31bed7447', owner: OWNER,
  admins: { [OWNER]: true }, grants: { [OWNER]: [] }, pubkeys: { [OWNER]: 'k' }, usernames: { [OWNER]: 'jabellae' },
  version: '2a4a141b6f', updatedAt: 1790013004738,
} as any, https443, machine);
assert.equal(claimed.gatewayId, '5f5a2602c5b1707b243e3fa31bed7447');
assert.equal(claimed.hostname, 'the-host', 'the machine name is its own field: the gatewayId is an identity, not a substitute for it');
assert.notEqual(claimed.hostname, claimed.gatewayId);
assert.equal(claimed.bootstrapped, true);
assert.equal(claimed.owner, OWNER);
assert.equal(claimed.ownerUsername, 'jabellae', 'the owner is named, whichever door asked');
assert.equal(claimed.adminCount, 1, 'the owner is an admin: one owner, no other admins, is 1 (Lua said 0)');
assert.equal(claimed.updatedAt, 1790013004738, 'epoch milliseconds as stored, not an ISO string');
assert.equal(claimed.version, '2a4a141b6f');
assert.deepEqual(Object.keys(claimed).sort(), CONTRACT);

// more admins count too; scopes are the owner's grants
const many = buildGatewayIdentityResponse({ owner: OWNER, admins: { [OWNER]: true, other1: true, other2: true }, grants: { [OWNER]: ['gateway:write'] } } as any, https443, machine);
assert.equal(many.adminCount, 3);
assert.deepEqual(many.scopes, ['gateway:write']);

// a damaged or partial snapshot never throws and never invents an owner
for (const junk of [{}, { owner: '' }, { owner: 5 }, { owner: OWNER, admins: 'x', grants: 'x', usernames: 'x', updatedAt: 'later' }, { owner: OWNER, usernames: { [OWNER]: 7 } }] as any[]) {
  const r = buildGatewayIdentityResponse(junk, https443, machine);
  assert.deepEqual(Object.keys(r).sort(), CONTRACT);
  assert.equal(r.bootstrapped, r.owner !== null);
  assert.ok(r.ownerUsername === null || typeof r.ownerUsername === 'string');
  assert.ok(r.updatedAt === null || typeof r.updatedAt === 'number');
}

// ── how the request arrived ──────────────────────────────────────────────────
assert.deepEqual(arrivalOf({ 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' }, 'http'), { scheme: 'https', port: 443 });
assert.deepEqual(arrivalOf({ 'x-forwarded-proto': 'http', 'x-forwarded-port': '8080' }, 'https'), { scheme: 'http', port: 8080 }, 'the edge says how it arrived');
assert.deepEqual(arrivalOf({ 'x-forwarded-proto': 'https, http' }, 'http'), { scheme: 'https', port: 443 }, 'the first value of a list');
assert.deepEqual(arrivalOf({ host: 'localhost:3000' }, 'http'), { scheme: 'http', port: 3000 }, 'no edge: the request itself');
assert.deepEqual(arrivalOf({}, 'https'), { scheme: 'https', port: 443 });
assert.deepEqual(arrivalOf({}, 'http'), { scheme: 'http', port: 80 });
assert.deepEqual(arrivalOf({ 'x-forwarded-port': 'not-a-port', host: 'x.test:99999' }, 'https'), { scheme: 'https', port: 443 }, 'an impossible port is ignored');

// ── the route answers exactly that, from the file the rest of netget writes ───
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-identity-'));
process.env.HOME = path.join(tmp, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.NETGET_DATA_DIR = path.join(tmp, 'data');
process.env.NETGET_MONAD_NAMESPACE = 'identity-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;
fs.mkdirSync(path.join(process.env.NETGET_DATA_DIR, 'runtime'), { recursive: true });
const express: any = createRequire(path.join(here, '../src/htmls/Netget-REACT/backend/routes/localNetget.js'))('express');
const router: any = (await import('../src/htmls/Netget-REACT/backend/routes/localNetget.js')).default;
const app = express(); app.use('/', router);
const server: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = (server.address() as any).port;
const get = (headers: Record<string, string> = {}): Promise<any> => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/gateway-identity', headers }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(JSON.parse(t))); }).on('error', reject);
});
try {
  const before = await get();
  assert.deepEqual(Object.keys(before).sort(), CONTRACT);
  assert.equal(before.bootstrapped, false);
  assert.equal(before.owner, null);
  assert.equal(before.gatewayId, os.hostname());
  assert.equal(before.hostname, os.hostname());

  fs.writeFileSync(path.join(process.env.NETGET_DATA_DIR, 'runtime', 'gateway-claims.json'), JSON.stringify({
    gatewayId: 'gw-1', owner: OWNER, admins: { [OWNER]: true }, grants: { [OWNER]: [] }, usernames: { [OWNER]: 'jabellae' }, version: 'v1', updatedAt: 1790013004738,
  }));
  const viaEdge = await get({ 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' });
  assert.deepEqual(Object.keys(viaEdge).sort(), CONTRACT);
  assert.equal(viaEdge.owner, OWNER);
  assert.equal(viaEdge.ownerUsername, 'jabellae');
  assert.equal(viaEdge.adminCount, 1);
  assert.equal(viaEdge.gatewayId, 'gw-1');
  assert.equal(viaEdge.hostname, os.hostname(), 'after the claim the hostname is still the machine, not the gateway id');
  assert.deepEqual([viaEdge.scheme, viaEdge.port], ['https', 443]);
  // the SAME request, with or without the edge, is the same answer apart from how it arrived
  const direct = await get();
  const { scheme: _s, port: _p, ...rest } = direct; const { scheme: _s2, port: _p2, ...restEdge } = viaEdge;
  assert.deepEqual(rest, restEdge);
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('gateway-identity-response.test.ts: all assertions passed');
process.exit(0);
