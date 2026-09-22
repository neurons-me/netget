// netget-gateway-harness-server.mjs — DISPOSABLE-INFRA-ONLY browser
// verification harness for the real GatewaySetup -> MainServerView ->
// LogsView navigation, against ONE real (disposable) Netget backend —
// no monad of its own (see below). Unlike claim-harness-server.mjs (which
// hand-stubs /gateway-identity and /openresty-status, and calls
// gatewaySetupSession.ts's functions directly instead of mounting the
// real Express router) and logs-harness-server.mjs (real backend, but
// claim-flow-agnostic), this harness mounts the REAL localNetget.js +
// adminSession.js routers (via testHarness.mjs's createLocalNetgetTestApp,
// same as logs-harness-server.mjs) PLUS the REAL setupSession.js router
// (the one piece testHarness.mjs deliberately omits) -- so the same
// backend answers /gateway-identity, /openresty-status, /apps, /domains,
// /logs, /ip-info, /main-server-namespace AND /setup/verify-code,
// /setup/challenge, /setup/claim, with nothing hand-rolled.
//
// Drives the namespaceHome demo pilot's "/netget" route tree: GatewaySetup
// (unclaimed) hands off, once claimed, to MainServerView + LogsView --
// all real components, never demo-only stand-ins. The namespaceHome demo
// itself is the single origin for BOTH the "netget" surface (this
// harness's endpoint) and the "Cleaker" surface (the real CleakerLanding
// already mounted at namespaceHome's "/") -- so, unlike the two-port
// claim/logs harnesses, there is only ONE demo origin here, seeded into
// this harness's own xConfig so /main-server-namespace resolves back to
// it (see the xConfig write below).
//
// Starts NO monad of its own. Netget's gateway claim no longer needs one:
// authority is derived from the OPERATOR's own real .me namespace claim
// (wherever it actually lives), verified via a real Ed25519 signature
// against that namespace's own keychain, then cached locally -- see
// gatewaySetupSession.ts's commitSignedClaim and GatewayClaimsManager.ts's
// materializeFromNamespaceClaim() for the full reasoning. An earlier
// version of this harness DID start its own dedicated monad (or tried
// reusing dev-harness/gui-catalog-harness-server.mts's) to give netget
// "its own ledger" to bootstrap into -- that whole model is gone now, not
// worked around: there is no separate netget-owned identity to create.
//
// What this harness needs instead is a way for netget's real namespace ->
// monad discovery (topologyResolver.ts's resolveSurface(), a TS port of
// surface_proxy.lua's own algorithm) to find the operator's ACTUAL
// namespace monad (gui-catalog-harness-dev, port 8162, run separately by
// gui-catalog-harness-server.mts) -- so it seeds a disposable apps.json
// entry for it below, the same mesh-registry shape /netget/apps already
// reads, honest about being seeded rather than heartbeat-reported (that
// gap already existed for /netget/apps and isn't closed here either).
//
// NEVER point this at a real NETGET_DATA_DIR. Always disposable. This
// script sets it before importing anything.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gateway-harness-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const HARNESS_PORT = Number(process.env.HARNESS_PORT || 4603);
// The operator's real namespace and where its monad actually runs --
// gui-catalog-harness-dev, started separately by
// dev-harness/gui-catalog-harness-server.mts. Seeded into apps.json below
// so resolveSurface({namespace: 'pageowner1.gui-catalog-harness.local'})
// finds it via its rootspace, exactly like a real mesh-registered app.
const OPERATOR_NAMESPACE = process.env.HARNESS_OPERATOR_NAMESPACE || 'gui-catalog-harness.local';
const OPERATOR_MONAD_ORIGIN = process.env.HARNESS_OPERATOR_MONAD_ORIGIN || 'http://127.0.0.1:8162';
// getGatewayRootNamespace() (netgetMonadProcess.ts) answers a DIFFERENT
// question than "who administers this gateway" -- it's "which namespace
// is THIS netget's own monad configured to serve" (NETGET_MONAD_NAMESPACE
// -> xConfig.mainServerName -> 'local.cleaker' default), a config value
// MainServerView displays as "Namespace", separate from ownerUsername/
// ownerIdentityHash (see that file's own header comment on why these are
// three distinct facts). This harness runs no monad of its own anymore
// (see the header comment above), so without this override that field
// would show the vestigial 'local.cleaker' default -- true but
// misleading here, since it has nothing to do with where OPERATOR_NAMESPACE's
// real authority actually lives. Set explicitly so the demo's own display
// stays honest, not because the two concepts have been unified.
process.env.NETGET_MONAD_NAMESPACE = OPERATOR_NAMESPACE;
// The namespaceHome demo's own single origin -- both the real CleakerLanding
// ("/") and this harness's Netget surface ("/netget") are served from
// here. Seeded into xConfig below so /main-server-namespace resolves back
// to it, which is what makes CleakerNetgetClaimView's and
// CleakerNetgetAdminSignView's own returnTo-origin checks pass same-origin
// instead of falling back to "http://local.cleaker".
const DEMO_ORIGIN = process.env.HARNESS_DEMO_ORIGIN || 'http://localhost:5178';

// A fake nginx logs directory -- realistic lines, real format (see
// logParsers.js's parseNginxAccessLog/parseNginxErrorLog regexes), never a
// real OpenResty log directory. Mirrors logs-harness-server.mjs's own
// seeding verbatim.
const fakeLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gateway-harness-nginx-'));
fs.writeFileSync(
  path.join(fakeLogsDir, 'access.log'),
  [
    '127.0.0.1 - - [12/Sep/2026:15:58:12 +0000] "GET /gateway-identity HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
    '127.0.0.1 - - [12/Sep/2026:15:58:41 +0000] "GET /apps/report HTTP/1.1" 200 128 "-" "monad.ai/1.0"',
    '203.0.113.9 - - [12/Sep/2026:15:59:03 +0000] "GET /favicon.ico HTTP/1.1" 404 0 "-" "Mozilla/5.0"',
  ].join('\n') + '\n',
  'utf8',
);
fs.writeFileSync(
  path.join(fakeLogsDir, 'error.log'),
  '2026/09/12 15:58:50 [error] 1234#0: *5 open() "/var/www/missing.html" failed (2: No such file or directory), client: 203.0.113.9, server: gateway-harness.local, request: "GET /missing.html HTTP/1.1"\n',
  'utf8',
);
process.env.NGINX_LOGS_PATH = fakeLogsDir;

const netgetRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';

const { createLocalNetgetTestApp } = await import(path.join(netgetRoot, 'src/htmls/Netget-REACT/backend/testHarness.mjs'));
const setupSessionRoutesModule = await import(path.join(netgetRoot, 'src/htmls/Netget-REACT/backend/routes/setupSession.js'));
const setupSessionRoutes = setupSessionRoutesModule.default;
const { createSetupSession } = await import(path.join(netgetRoot, 'src/modules/NetGetX/Auth/gatewaySetupSession.ts'));
const { getGatewayClaimsPath } = await import(path.join(netgetRoot, 'src/modules/NetGetX/Auth/GatewayClaimsManager.ts'));
const { resolveLedgerIdentity } = await import(path.join(netgetRoot, 'src/kernel/ledgerIdentity.ts'));

console.log(`[harness] NETGET_DATA_DIR=${tmpDataDir}`);
console.log(`[harness] NGINX_LOGS_PATH=${fakeLogsDir}`);

// Real localNetget.js's own /main-server-namespace route wins (mounted
// inside createLocalNetgetTestApp below) -- pre-seed the real xConfig
// file instead of shadowing that route, same approach
// logs-harness-server.mjs already uses.
{
  const xConfigPath = path.join(tmpDataDir, 'xConfig.json');
  fs.writeFileSync(xConfigPath, JSON.stringify({ mainServerName: DEMO_ORIGIN }, null, 2), 'utf8');
}

// Seed apps.json (the real mesh-registry file topologyResolver.ts's
// resolveSurface() reads via readReportedApps()) with ONE entry for the
// operator's actual namespace monad. Not heartbeat-reported -- seeded,
// same honest limitation /netget/apps already has -- but the SAME reader
// code and schema, so resolveSurface() finds it exactly like it would a
// real mesh-registered app.
{
  const registryDir = path.join(tmpDataDir, 'runtime');
  fs.mkdirSync(registryDir, { recursive: true });
  const seeded = {
    version: 1,
    updatedAt: new Date().toISOString(),
    apps: {
      'gui-catalog-harness': {
        id: 'gui-catalog-harness',
        name: 'gui-catalog-harness',
        host: '127.0.0.1',
        port: 8162,
        lastSeenMs: Date.now(),
        // A real mesh-registered app refreshes this every ~3s (a live
        // heartbeat, see CLAUDE.md), so 45s is the right TTL for it. This
        // entry is seeded ONCE at harness startup, never refreshed -- a
        // 45s TTL would go stale partway through a normal manual
        // walkthrough (sign in, pick a key, unlock, sign). Long-lived on
        // purpose: this stands in for "known", not "recently heartbeated".
        ttlMs: 24 * 60 * 60 * 1000,
        trust: 'owner',
        metadata: {
          monadName: 'gui-catalog-harness-dev',
          namespace: OPERATOR_NAMESPACE,
          endpoint: OPERATOR_MONAD_ORIGIN,
        },
        tags: ['pilot', 'disposable'],
      },
    },
  };
  fs.writeFileSync(path.join(registryDir, 'apps.json'), JSON.stringify(seeded, null, 2), 'utf8');
  console.log(`[harness] seeded apps.json: namespace "${OPERATOR_NAMESPACE}" -> ${OPERATOR_MONAD_ORIGIN}`);
}

// One origin here (unlike the two-port claim/logs harnesses): the
// namespaceHome demo serves both the Netget surface and the real
// CleakerLanding from the same dev server.
const app = createLocalNetgetTestApp({ cors: { origin: [DEMO_ORIGIN] } });
app.use('/', setupSessionRoutes);

const ledgerIdentity = resolveLedgerIdentity();

// Prints a fresh setup code on demand -- this harness's stand-in for what
// `netget init`/`netget claim` would print in a terminal. Mirrors
// claim-harness-server.mjs's identical endpoint.
app.post('/harness/new-setup-code', (req, res) => {
  const session = createSetupSession(ledgerIdentity.id);
  console.log(`[harness] fresh setup code: ${session.code}`);
  res.json(session);
});

// Harness-only stand-in for an operator granting a real, already-claimed
// identity admin access to this gateway's logs -- copied verbatim from
// logs-harness-server.mjs (not a shared helper anywhere in the codebase;
// both existing harnesses already each hand-roll their own harness-only
// endpoints rather than sharing a module, and this follows that same
// convention rather than inventing a new shared one). NOT part of
// production.
app.post('/harness/grant-admin', (req, res) => {
  const identityHash = String(req.body?.identityHash || '').trim();
  const username = String(req.body?.username || '').trim() || identityHash;
  if (!identityHash) return res.status(400).json({ ok: false, error: 'IDENTITY_HASH_REQUIRED' });
  const claimsPath = getGatewayClaimsPath();
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  let snapshot = {};
  try { snapshot = JSON.parse(fs.readFileSync(claimsPath, 'utf8')); } catch { /* fresh file */ }
  snapshot.gatewayId = snapshot.gatewayId || 'gateway-harness.local';
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
  console.log(`[harness] real /gateway-identity, /openresty-status, /apps, /domains, /logs, /ip-info, /main-server-namespace, /setup/* mounted`);
  console.log(`[harness] fake nginx logs at ${fakeLogsDir}`);
  console.log(`[harness] xConfig.mainServerName seeded to ${DEMO_ORIGIN} -- claim/admin-sign redirects will land back there`);
  console.log(`[harness] POST /harness/new-setup-code to mint a setup code for GatewaySetup's UI`);
  console.log(`[harness] POST /harness/grant-admin {identityHash, username} to grant a signed-in identity 'gateway:read' for LogsView`);
  console.log(`[harness] expects the namespaceHome demo at ${DEMO_ORIGIN} (DEMO=true DEMO_ROLE=namespaceHome DEMO_NETGET_ORIGIN=${DEMO_ORIGIN} npx vite --port 5178) pointed here via ?netgetEndpoint=http://127.0.0.1:${HARNESS_PORT}`);
});
