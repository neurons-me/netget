// logs-harness-server.mjs — DISPOSABLE-INFRA-ONLY browser verification
// harness for the real /logs viewer + real admin sign-in flow. Mounts
// the REAL localNetget.js `/logs` route and the REAL adminSession.js
// routes (backed by adminSession.ts's live-keychain verification —
// see keychainKeyVerification.ts) against a fake nginx logs directory,
// plus a real disposable monad so adminSession.ts's fetchKeychainKey has
// a real keychain to check against.
//
// Sibling to claim-harness-server.mjs (same disposable-port/guard
// pattern) — this one drives demo/logsFlow.html (the "netget role": the
// real LogsView) and demo/claimFlow.html?role=cleaker (the "Cleaker
// role", reused UNCHANGED — CleakerLanding's /keychain/admin-sign route
// needs nothing this harness doesn't already provide via
// /harness/monad-origin and /main-server-namespace, both modeled
// directly on claim-harness-server.mjs's own).
//
// NEVER point this at a real NETGET_DATA_DIR/NETGET_MONAD_NAME. Always
// disposable. This script sets both before importing anything.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-logs-harness-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
// Fixed name + namespace (not per-PID/timestamp) so restarting this
// harness keeps landing on the same monad port and the same NRP
// namespace across runs — see claim-harness-server.mjs's identical
// reasoning on its own TEST_MONAD_NAME.
const TEST_MONAD_NAME = 'netget-logs-harness-dev';
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;
// Deliberately NOT setting NETGET_MONAD_NAMESPACE — leaving it at
// netgetMonadProcess.ts's own UNCONFIGURED_DEFAULT_NAMESPACE
// ('local.cleaker'), same as claim-harness-server.mjs. The Cleaker-role
// demo page's identity registration root is pinned to that exact string
// (see claim-harness-server.mjs's own comment on this) — pinning this
// harness to anything else would silently break storage prefixing for
// whatever identity gets registered against it (namespaceToKernelPrefix()
// only derives a "users.<handle>" prefix when a claim's root matches the
// monad's OWN root).

const HARNESS_PORT = Number(process.env.HARNESS_PORT || 4602);
// Where the "Cleaker role" demo page (claimFlow.html?role=cleaker) is
// served — this harness's OWN /main-server-namespace (queried by
// LogsView's resolveCleakerOrigin, same as claim-harness-server.mjs's
// identical endpoint) must answer with THIS, not with itself, so
// "Sign in as admin" redirects to the real Cleaker-role page.
const CLEAKER_ORIGIN = process.env.HARNESS_CLEAKER_ORIGIN || 'http://127.0.0.1:5177';
// Where the "netget role" demo page (logsFlow.html) is served — the
// Cleaker-role vite instance needs THIS value in its own DEMO_NETGET_ORIGIN
// env var (this harness cannot set that for it — different process), since
// it becomes `returnTo`'s origin and CleakerNetgetAdminSignView only
// accepts a returnTo whose origin matches netget's OWN configured address
// (see CleakerLanding.tsx's returnToAuthorized check).
const NETGET_ROLE_ORIGIN = process.env.HARNESS_NETGET_ROLE_ORIGIN || 'http://127.0.0.1:5176';

// A fake nginx logs directory -- realistic lines, real format (see
// logParsers.js's parseNginxAccessLog/parseNginxErrorLog regexes), never
// a real OpenResty log directory.
const fakeLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-logs-harness-nginx-'));
fs.writeFileSync(
  path.join(fakeLogsDir, 'access.log'),
  [
    '127.0.0.1 - - [11/Sep/2026:09:58:12 +0000] "GET /gateway-identity HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
    '127.0.0.1 - - [11/Sep/2026:09:58:41 +0000] "GET /apps/report HTTP/1.1" 200 128 "-" "monad.ai/1.0"',
    '203.0.113.7 - - [11/Sep/2026:09:59:03 +0000] "GET /favicon.ico HTTP/1.1" 404 0 "-" "Mozilla/5.0"',
  ].join('\n') + '\n',
  'utf8',
);
fs.writeFileSync(
  path.join(fakeLogsDir, 'error.log'),
  '2026/09/11 09:58:50 [error] 1234#0: *5 open() "/var/www/missing.html" failed (2: No such file or directory), client: 203.0.113.7, server: logs-harness.local, request: "GET /missing.html HTTP/1.1"\n',
  'utf8',
);
process.env.NGINX_LOGS_PATH = fakeLogsDir;

const netgetRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';

const { createLocalNetgetTestApp } = await import(path.join(netgetRoot, 'src/htmls/Netget-REACT/backend/testHarness.mjs'));
const { getGatewayClaimsPath } = await import(path.join(netgetRoot, 'src/modules/NetGetX/Auth/GatewayClaimsManager.ts'));
const { startNetgetMonad, getGatewayRootNamespace } = await import(path.join(netgetRoot, 'src/kernel/netgetMonadProcess.ts'));
const { installMonadOriginGuard } = await import(path.join(netgetRoot, 'src/kernel/testing/monadOriginGuard.ts'));
const { reservePort } = await import(path.join(netgetRoot, 'src/kernel/testing/reservePort.ts'));
const { readMonadRecord } = await import('monad.ai');

console.log(`[harness] NETGET_DATA_DIR=${tmpDataDir}`);
console.log(`[harness] NGINX_LOGS_PATH=${fakeLogsDir}`);

// `logs.*` NRP reads proxy to LOG_SOURCE_URL under LOG_SOURCE_NAMESPACE —
// generic in monad.ai, set by netget's own proxy.js in production (see
// logsSourceProxy.ts). This harness's browser demo talks to /logs
// directly on this Express app (the user's own explicit scope call for
// this delivery), so these two vars only matter if something exercises
// the monad's NRP surface too -- set for parity with the real deployment,
// harmless otherwise. Must be set BEFORE startNetgetMonad(), since
// monad.ai's child process inherits env at spawn time, not on read.
process.env.LOG_SOURCE_URL = `http://127.0.0.1:${HARNESS_PORT}`;
process.env.LOG_SOURCE_NAMESPACE = `netget.${getGatewayRootNamespace()}`;

const existingOwnRecord = await readMonadRecord(TEST_MONAD_NAME).catch(() => null);
const reservedPort = await reservePort(existingOwnRecord?.port);
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
installMonadOriginGuard([expectedOrigin]);

const monadStatus = await startNetgetMonad({ port: reservedPort });
if (!monadStatus.running) {
  console.error('[harness] disposable monad failed to start:', monadStatus.message);
  process.exit(1);
}
if (monadStatus.origin !== expectedOrigin) {
  console.error(`[harness] FATAL: startNetgetMonad() reported origin ${monadStatus.origin}, not the reserved ${expectedOrigin}.`);
  process.exit(1);
}
const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
const realRecord = await readMonadRecord('netget').catch(() => null);
console.log(`[harness] disposable monad running at ${monadStatus.origin} (namespace ${getGatewayRootNamespace()})${realRecord ? `; the real "netget" monad is separately on port ${realRecord.port}` : ' (the real "netget" monad is not currently running)'}.`);
console.log(`[harness] this run's monad: name="${TEST_MONAD_NAME}" pid=${ownRecord.pid} port=${ownRecord.port}`);

const app = createLocalNetgetTestApp({ cors: { origin: [CLEAKER_ORIGIN, NETGET_ROLE_ORIGIN] } });

// localNetgetRoutes (mounted inside createLocalNetgetTestApp, above)
// already serves the REAL `/main-server-namespace` route, reading
// xConfig.mainServerName — first-registered route wins in Express, so
// adding a second handler for the same path here would never be reached.
// Pre-seed the real xConfig file instead of shadowing the real route,
// same as gateway-claims.json is hand-written below rather than routed
// around.
{
  const xConfigPath = path.join(tmpDataDir, 'xConfig.json');
  fs.writeFileSync(xConfigPath, JSON.stringify({ mainServerName: CLEAKER_ORIGIN }, null, 2), 'utf8');
}

app.get('/harness/monad-origin', (req, res) => {
  res.json({ origin: monadStatus.origin });
});

// Harness-only stand-in for an operator granting a real, already-claimed
// identity admin access to this gateway's logs. NOT part of production —
// production's own owner/admin grant already exists via the (separately
// verified) gateway-claim flow; this just lets a manual walkthrough grant
// the SAME real capability to whichever identity the person actually
// registers/signs in with in their browser, without fabricating a vault
// entry server-side.
app.post('/harness/grant-admin', (req, res) => {
  const identityHash = String(req.body?.identityHash || '').trim();
  const username = String(req.body?.username || '').trim() || identityHash;
  if (!identityHash) return res.status(400).json({ ok: false, error: 'IDENTITY_HASH_REQUIRED' });
  const claimsPath = getGatewayClaimsPath();
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  let snapshot = {};
  try { snapshot = JSON.parse(fs.readFileSync(claimsPath, 'utf8')); } catch { /* fresh file */ }
  snapshot.gatewayId = snapshot.gatewayId || 'logs-harness.local';
  snapshot.owner = snapshot.owner || identityHash;
  snapshot.admins = { ...(snapshot.admins || {}), [identityHash]: true };
  snapshot.grants = { ...(snapshot.grants || {}), [identityHash]: ['gateway:read'] };
  snapshot.pubkeys = snapshot.pubkeys || {};
  snapshot.usernames = { ...(snapshot.usernames || {}), [identityHash]: username };
  fs.writeFileSync(claimsPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`[harness] granted admin (gateway:read) to identityHash=${identityHash}`);
  res.json({ ok: true, gatewayId: snapshot.gatewayId, owner: snapshot.owner });
});

app.listen(HARNESS_PORT, '127.0.0.1', () => {
  console.log(`[harness] listening at http://127.0.0.1:${HARNESS_PORT}`);
  console.log(`[harness] real /logs + /admin-session/* mounted; fake nginx logs at ${fakeLogsDir}`);
  console.log(`[harness] POST /harness/grant-admin {identityHash, username} to grant a real signed-in identity admin access`);
  console.log(`[harness] expects the "netget role" demo (logsFlow.html) at ${NETGET_ROLE_ORIGIN} and the "Cleaker role" demo at ${CLEAKER_ORIGIN} — launch the Cleaker-role vite instance with DEMO_NETGET_ORIGIN=${NETGET_ROLE_ORIGIN}.`);
});
