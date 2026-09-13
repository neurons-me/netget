// claim-harness-server.mjs — DISPOSABLE-INFRA-ONLY browser verification
// harness for the netget <-> Cleaker keychain claim flow. Mounts the REAL
// gatewaySetupSession.ts functions + a minimal /gateway-identity,
// /openresty-status, /main-server-namespace so GatewaySetup (mounted by
// the GUI demo harness in "netget" role) has a real backend to talk to,
// without going anywhere near netget's real App.jsx/proxy.js (which
// manages real OpenResty on `netget init` — never run here).
//
// NEVER point this at a real NETGET_DATA_DIR/NETGET_MONAD_NAME. Always
// disposable. This script sets both before importing anything.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import express from 'express';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-claim-harness-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
// Deliberately a FIXED name, not per-PID/timestamp: startMonadProcess()
// (monad.ai) reuses a monad's PREVIOUS port when its own prior record
// for that exact name is still on disk (findFreePort(existing?.port)),
// so restarting this harness with the same name keeps landing on the
// same port instead of drifting to a new random one every time --
// genuinely disposable data either way (a fresh NETGET_DATA_DIR every
// run), just a stable port for whatever demo/claimFlow instance this
// run's browser session is pointed at.
const TEST_MONAD_NAME = 'netget-claim-harness-dev';
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const CLEAKER_ORIGIN = process.env.HARNESS_CLEAKER_ORIGIN || 'http://127.0.0.1:5175';
const HARNESS_PORT = Number(process.env.HARNESS_PORT || 4601);

const netgetRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';

const { createSetupSession, verifySetupCode, issueClaimChallenge, commitSignedClaim } =
  await import(path.join(netgetRoot, 'src/modules/NetGetX/Auth/gatewaySetupSession.ts'));
const { startNetgetMonad, getGatewayRootNamespace } = await import(path.join(netgetRoot, 'src/kernel/netgetMonadProcess.ts'));
const { GatewayClaimsManager } = await import(path.join(netgetRoot, 'src/modules/NetGetX/Auth/GatewayClaimsManager.ts'));
const { resolveLedgerIdentity } = await import(path.join(netgetRoot, 'src/kernel/ledgerIdentity.ts'));
const { installMonadOriginGuard } = await import(path.join(netgetRoot, 'src/kernel/testing/monadOriginGuard.ts'));
const { reservePort } = await import(path.join(netgetRoot, 'src/kernel/testing/reservePort.ts'));
const { readMonadRecord } = await import('monad.ai');

console.log(`[harness] NETGET_DATA_DIR=${tmpDataDir}`);
console.log(`[harness] NETGET_MONAD_NAME=${TEST_MONAD_NAME}`);

// 2026-09-10 found that a "disposable" test monad can resolve to the SAME
// origin as the real ambient 'netget' monad under conditions not fully
// root-caused (see project_netget_monad_test_isolation_gap.md). A check
// done only AFTER startNetgetMonad() returns — compare-and-bail — leaves
// a real window: whatever traffic monad.ai's own startup made before that
// comparison (its health probe) has already gone out by the time anything
// notices. So instead: reserve the exact port this monad will use FIRST
// (preferring this harness's previous port when it's still free, so
// restarts keep landing on the same port — see TEST_MONAD_NAME's own
// comment above), arm the guard for THAT port before starting anything,
// then hand that same port to startNetgetMonad({ port }). Nothing this
// process does from here on, including monad.ai's own bootstrap probe, is
// unobserved — a wrong-destination request is blocked before it is sent,
// not merely detected afterward. This harness talks to a real Cleaker
// identity + keychain during manual verification, so that distinction
// matters more here than in an automated test.
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
  console.error(`[harness] FATAL: startNetgetMonad() reported origin ${monadStatus.origin}, not the reserved ${expectedOrigin} — the guard should have already blocked whatever caused this.`);
  process.exit(1);
}

const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
if (!ownRecord || ownRecord.port !== reservedPort) {
  console.error(`[harness] FATAL: no monad record found under our own name "${TEST_MONAD_NAME}" on the reserved port ${reservedPort}.`);
  process.exit(1);
}
const realRecord = await readMonadRecord('netget').catch(() => null);
console.log(`[harness] disposable monad running at ${monadStatus.origin} (namespace ${getGatewayRootNamespace()}) — every request from this process is now guarded to that origin only${realRecord ? `; the real "netget" monad is separately on port ${realRecord.port}` : ' (the real "netget" monad is not currently running)'}.`);
console.log(`[harness] this run's monad: name="${TEST_MONAD_NAME}" pid=${ownRecord.pid} port=${ownRecord.port} started=${ownRecord.startedAt || 'unknown'}`);
console.log(`[harness] before "monads delete ${TEST_MONAD_NAME}", check "monads status ${TEST_MONAD_NAME}" reports this SAME pid — a different pid means a leftover from an earlier run, not this one.`);

const ledgerIdentity = resolveLedgerIdentity();
const app = express();
app.use(express.json());
// The real deployment is same-origin (netget serves its own frontend);
// this harness deliberately runs the frontend on a DIFFERENT port to
// prove the browser-level flow, so it needs real CORS headers a
// same-origin production setup never would.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/gateway-identity', (req, res) => {
  const mgr = new GatewayClaimsManager();
  const snap = mgr.read();
  res.json({
    bootstrapped: !!snap?.owner,
    ownerUsername: snap?.owner ? (snap.usernames?.[snap.owner] ?? null) : null,
  });
});

app.get('/openresty-status', (req, res) => {
  res.json({ platform: 'harness', ok: true, serviceInstalled: true, serviceActive: true, httpListening: true, httpsListening: true, mode: 'harness' });
});

app.get('/main-server-namespace', (req, res) => {
  res.json({ namespace: getGatewayRootNamespace(), mainServerName: CLEAKER_ORIGIN });
});

// The Cleaker-role demo page needs this harness's disposable monad origin
// to talk to the same kernel the netget-role page is using — that origin
// is whatever port this run's disposable monad actually landed on (see
// the isolation check above), never a value the frontend should guess or
// hardcode. Source of truth, read fresh, not baked into the demo build.
app.get('/harness/monad-origin', (req, res) => {
  res.json({ origin: monadStatus.origin });
});

app.post('/setup/verify-code', (req, res) => {
  const result = verifySetupCode(String(req.body?.code || ''));
  res.status(result.ok ? 200 : 401).json(result);
});

app.post('/setup/challenge', (req, res) => {
  const result = issueClaimChallenge(
    String(req.body?.setupToken || ''),
    String(req.body?.returnOrigin || ''),
    String(req.body?.returnPath || ''),
  );
  res.status(result.ok ? 200 : 401).json(result);
});

app.post('/setup/claim', async (req, res) => {
  const result = await commitSignedClaim(String(req.body?.setupToken || ''), req.body?.proof);
  res.status(result.ok ? 200 : 400).json(result);
});

// Prints a fresh setup code on demand -- the harness's stand-in for what
// `netget init`/`netget claim` would print in a terminal.
app.post('/harness/new-setup-code', (req, res) => {
  const session = createSetupSession(ledgerIdentity.id);
  console.log(`[harness] fresh setup code: ${session.code}`);
  res.json(session);
});

app.listen(HARNESS_PORT, '127.0.0.1', () => {
  console.log(`[harness] listening at http://127.0.0.1:${HARNESS_PORT}`);
  console.log(`[harness] POST /harness/new-setup-code to mint a setup code`);
});
