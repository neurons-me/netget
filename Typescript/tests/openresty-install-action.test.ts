import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Coverage for the browser-triggered "Install OpenResty" v1: the async
// job runner (openRestyInstallJob.ts), the Homebrew-availability check
// (openRestyService.ts's canInstallOpenRestyViaHomebrew), and the
// pre-claim/post-claim authorization split (installActionAuth.ts).
//
// A fake `brew` on PATH stands in for the real binary (same fake-bin
// technique as certbot-provisioning.test.ts's fake certbot/sudo) — this
// test NEVER shells out to the real Homebrew, never touches
// /Library/LaunchDaemons, and never starts or restarts any real service.
// NETGET_DATA_DIR is a disposable temp dir, so both the setup-session
// file and the hand-written gateway-claims.json snapshot below are
// throwaway — no real gateway-claims state, no monad, no ledger touched
// (hasOwner()/isAdmin()/getScopes() are local-file reads only; the ledger
// is never consulted by those, confirmed by reading GatewayClaimsManager.ts).

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fakebin-brew-'));
const logPath = path.join(tmpBin, 'invocations.log');
fs.writeFileSync(logPath, '');
const fakePrefix = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fake-brew-prefix-'));

const brewScript = path.join(tmpBin, 'brew');
fs.writeFileSync(brewScript, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NETGET_TEST_LOG, 'brew ' + args.join(' ') + '\\n');

if (args[0] === '--prefix') {
  process.stdout.write(process.env.NETGET_TEST_BREW_PREFIX + '\\n');
  process.exit(0);
}

if (args[0] === 'install') {
  const delayMs = Number(process.env.NETGET_TEST_BREW_DELAY_MS || 0);
  const exitCode = Number(process.env.NETGET_TEST_BREW_EXIT_CODE || 0);
  console.log('==> Installing openresty/brew/openresty');
  setTimeout(() => {
    if (exitCode === 0) {
      console.log('==> Pouring openresty--1.27.1.1.bottle.tar.gz');
      console.log('\\uD83C\\uDF7A  openresty/brew/openresty was successfully installed.');
    } else {
      console.error('Error: simulated brew install failure');
    }
    process.exit(exitCode);
  }, delayMs);
  return;
}

process.exit(1);
`, 'utf8');
fs.chmodSync(brewScript, 0o755);

process.env.PATH = `${tmpBin}${path.delimiter}${process.env.PATH}`;
process.env.NETGET_TEST_LOG = logPath;
process.env.NETGET_TEST_BREW_PREFIX = fakePrefix;
process.env.NETGET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-openresty-install-'));

const { canInstallOpenRestyViaHomebrew } = await import('../src/modules/NetGetX/OpenResty/openRestyService.ts');
const { startInstallJob, getInstallJobSnapshot } = await import('../src/modules/NetGetX/OpenResty/openRestyInstallJob.ts');
const { checkInstallActionAuth } = await import('../src/modules/NetGetX/Auth/installActionAuth.ts');
const { createSetupSession, verifySetupCode, isSetupSessionActive } = await import('../src/modules/NetGetX/Auth/gatewaySetupSession.ts');
const { getGatewayClaimsPath } = await import('../src/modules/NetGetX/Auth/GatewayClaimsManager.ts');

function fakeReq(headers: Record<string, string>) {
  return { header: (name: string) => headers[name.toLowerCase()] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── canInstallOpenRestyViaHomebrew() ────────────────────────────────────
const availability = canInstallOpenRestyViaHomebrew();
assert.equal(availability.available, true, availability.reason);

// ── Pre-claim auth: setup-session token ─────────────────────────────────
const session = createSetupSession('install-action-test.local');
const verified = verifySetupCode(session.code);
assert.ok(verified.ok, 'setup code must verify');
const setupToken = (verified as { setupToken: string }).setupToken;

assert.equal(isSetupSessionActive(setupToken), true);
assert.equal(isSetupSessionActive('wrong-token'), false);

const noTokenAuth = checkInstallActionAuth(fakeReq({}));
assert.equal(noTokenAuth.ok, false);
assert.equal((noTokenAuth as { error: string }).error, 'SETUP_TOKEN_REQUIRED');

const wrongTokenAuth = checkInstallActionAuth(fakeReq({ 'x-netget-setup-token': 'nope' }));
assert.equal(wrongTokenAuth.ok, false);
assert.equal((wrongTokenAuth as { error: string }).error, 'SETUP_SESSION_INACTIVE');

const setupAuth = checkInstallActionAuth(fakeReq({ 'x-netget-setup-token': setupToken }));
assert.equal(setupAuth.ok, true);
assert.equal((setupAuth as { mode: string }).mode, 'setup');

// ── Post-claim auth: admin identity + gateway:write scope ───────────────
const ADMIN_IDENTITY = 'a'.repeat(64);
const claimsSnapshot = {
  gatewayId: 'install-action-test.local',
  owner: ADMIN_IDENTITY,
  admins: { [ADMIN_IDENTITY]: true },
  grants: { [ADMIN_IDENTITY]: ['gateway:write'] },
  pubkeys: {},
  usernames: { [ADMIN_IDENTITY]: 'testadmin' },
};
const claimsPath = getGatewayClaimsPath();
fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
fs.writeFileSync(claimsPath, JSON.stringify(claimsSnapshot, null, 2), 'utf8');

const noIdentityAuth = checkInstallActionAuth(fakeReq({}));
assert.equal(noIdentityAuth.ok, false);
assert.equal((noIdentityAuth as { error: string }).error, 'IDENTITY_REQUIRED');

const noScopeAuth = checkInstallActionAuth(fakeReq({ 'x-netget-identity': ADMIN_IDENTITY, 'x-netget-scopes': '[]' }));
assert.equal(noScopeAuth.ok, false);
assert.equal((noScopeAuth as { error: string }).error, 'CAPABILITY_DENIED');

const nonAdminAuth = checkInstallActionAuth(fakeReq({ 'x-netget-identity': 'b'.repeat(64), 'x-netget-scopes': '["gateway:write"]' }));
assert.equal(nonAdminAuth.ok, false);
assert.equal((nonAdminAuth as { error: string }).error, 'NOT_AN_ADMIN');

const adminAuth = checkInstallActionAuth(fakeReq({ 'x-netget-identity': ADMIN_IDENTITY, 'x-netget-scopes': '["gateway:write"]' }));
assert.equal(adminAuth.ok, true);
assert.equal((adminAuth as { mode: string }).mode, 'admin');

// ── Install job: success path, async (not blocking), progress visible ───
process.env.NETGET_TEST_BREW_DELAY_MS = '300';
process.env.NETGET_TEST_BREW_EXIT_CODE = '0';

const start1 = startInstallJob();
assert.equal(start1.ok, true);
assert.ok(start1.job, 'job must be returned');
assert.equal(start1.job!.status, 'running', 'must be running immediately -- spawn(), not a blocking execSync');

// Concurrency guard: a second call while still running returns the SAME job.
const start2 = startInstallJob();
assert.equal(start2.job!.id, start1.job!.id, 'a second start while running must return the SAME job, not spawn a second brew install');

let finalSnapshot = getInstallJobSnapshot();
const deadline = Date.now() + 5000;
while (finalSnapshot && finalSnapshot.status === 'running' && Date.now() < deadline) {
  await sleep(50);
  finalSnapshot = getInstallJobSnapshot();
}
assert.ok(finalSnapshot, 'job snapshot must exist');
assert.equal(finalSnapshot!.status, 'success', `expected success, got: ${JSON.stringify(finalSnapshot)}`);
assert.ok(finalSnapshot!.finishedAt, 'finishedAt must be set once done');
assert.ok(finalSnapshot!.log.some((l) => l.includes('successfully installed')), 'log must capture the fake brew output');

// ── Install job: failure path, a NEW job after the first finished ───────
process.env.NETGET_TEST_BREW_DELAY_MS = '50';
process.env.NETGET_TEST_BREW_EXIT_CODE = '1';

const start3 = startInstallJob();
assert.notEqual(start3.job!.id, start1.job!.id, 'once the first job finished, a new call must start a fresh job');

let failSnapshot = getInstallJobSnapshot();
const deadline2 = Date.now() + 5000;
while (failSnapshot && failSnapshot.status === 'running' && Date.now() < deadline2) {
  await sleep(50);
  failSnapshot = getInstallJobSnapshot();
}
assert.equal(failSnapshot!.status, 'error');
assert.ok(failSnapshot!.log.some((l) => l.includes('simulated brew install failure')));

console.log('openresty-install-action ok');
