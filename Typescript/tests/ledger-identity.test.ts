/**
 * Proves the guarantees this session was scoped down to (see
 * src/kernel/ledgerIdentity.ts's own doc comments for the reasoning):
 *
 *   - A fresh installation generates a real random seed once and persists it.
 *   - Restarting (a second resolve call, same data dir) reuses that exact
 *     seed — never regenerated.
 *   - The persisted seed is independent of the machine hostname AND of
 *     whatever domain/namespace an operator later configures.
 *   - Two separate fresh installations get two different seeds (and ids).
 *   - An installation with existing state (an owner claim, or a legacy
 *     domains.db) but no ledger-identity.json yet is a migration case, not
 *     a fresh install: it keeps resolving to the old hostname-derived seed,
 *     and — critically — nothing gets silently written over it.
 *   - A ledger-identity.json that EXISTS but is corrupt/unreadable is a
 *     different situation from one that was never created: this
 *     installation already had a persisted, random-seed identity, so
 *     resolveLedgerIdentity() must throw and refuse to start rather than
 *     silently fall back to the old hostname-derived seed (which would be
 *     switching this ledger to a different identity, not recovering the
 *     one it had) — regardless of whether the legacy-installation signals
 *     (owner claim / domains.db) are present or not.
 *   - A ledger-identity.json that is simply MISSING is not automatically a
 *     legacy install either: a separate durable marker file, written
 *     alongside the identity file on every fresh install, records that
 *     this installation was already given one. If the marker is present
 *     but the identity file isn't, that's data loss — resolveLedgerIdentity()
 *     must throw, never fall back to the hostname seed or generate a
 *     second, different identity over the one that already existed.
 *
 * Each case gets its own NETGET_DATA_DIR (env override — see
 * utils/netgetPaths.js's resolveDataDirOnce()) so installations never
 * bleed into each other within this one process.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { resolveLedgerIdentity } = await import('../src/kernel/ledgerIdentity.ts');

function freshDataDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `netget-ledger-${label}-`));
}

function withDataDir<T>(dir: string, fn: () => T): T {
  const previous = process.env.NETGET_DATA_DIR;
  process.env.NETGET_DATA_DIR = dir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.NETGET_DATA_DIR;
    else process.env.NETGET_DATA_DIR = previous;
  }
}

// 1) Fresh install: real random seed, generated once, persisted to disk.
const installA = freshDataDir('install-a');
const firstResolution = withDataDir(installA, () => resolveLedgerIdentity());
assert.equal(firstResolution.isNew, true, 'a genuinely empty data dir must be treated as a fresh install');
assert.equal(firstResolution.requiresMigration, false);
assert.match(firstResolution.seedHex, /^[0-9a-f]{64}$/, 'seedHex must be 32 random bytes, hex-encoded');

const identityFilePath = path.join(installA, 'ledger-identity.json');
assert.ok(fs.existsSync(identityFilePath), 'a fresh install must persist ledger-identity.json');
const onDisk = JSON.parse(fs.readFileSync(identityFilePath, 'utf8'));
assert.equal(onDisk.seedHex, firstResolution.seedHex);
assert.equal(onDisk.id, firstResolution.id);

const markerFilePath = path.join(installA, 'ledger-identity.initialized.json');
assert.ok(fs.existsSync(markerFilePath), 'a fresh install must also persist the durable initialization marker, not just the identity file');

// 2) Restart (second resolve call, same data dir): exact same seed, not
// regenerated, and no longer reported as "new".
const secondResolution = withDataDir(installA, () => resolveLedgerIdentity());
assert.equal(secondResolution.seedHex, firstResolution.seedHex, 'a restart must reuse the persisted seed');
assert.equal(secondResolution.id, firstResolution.id);
assert.equal(secondResolution.isNew, false);
assert.equal(secondResolution.requiresMigration, false);

// 3) Hostname-independence: mutating the shared 'os' module's hostname()
// (both this test and ledgerIdentity.ts resolve the same Node builtin
// instance) must not change the already-persisted seed.
const realHostname = os.hostname;
try {
  (os as unknown as { hostname: () => string }).hostname = () => 'renamed-host-for-test.local';
  const afterRename = withDataDir(installA, () => resolveLedgerIdentity());
  assert.equal(afterRename.seedHex, firstResolution.seedHex, 'renaming the host must not change a persisted ledger identity');
} finally {
  (os as unknown as { hostname: () => string }).hostname = realHostname;
}

// 4) Domain/namespace-independence: ledgerIdentity.ts never reads
// NETGET_MONAD_NAMESPACE (or any domain config) at all — changing it must
// not change the already-persisted seed.
const previousNamespace = process.env.NETGET_MONAD_NAMESPACE;
try {
  process.env.NETGET_MONAD_NAMESPACE = 'this-changed-later.example';
  const afterDomainChange = withDataDir(installA, () => resolveLedgerIdentity());
  assert.equal(afterDomainChange.seedHex, firstResolution.seedHex, 'changing the configured domain/namespace must not change a persisted ledger identity');
} finally {
  if (previousNamespace === undefined) delete process.env.NETGET_MONAD_NAMESPACE;
  else process.env.NETGET_MONAD_NAMESPACE = previousNamespace;
}

// 5) Two fresh installations get two different identities.
const installB = freshDataDir('install-b');
const installBResolution = withDataDir(installB, () => resolveLedgerIdentity());
assert.equal(installBResolution.isNew, true);
assert.notEqual(installBResolution.seedHex, firstResolution.seedHex, 'two independent fresh installs must not collide on the same seed');
assert.notEqual(installBResolution.id, firstResolution.id);

// 6) Existing installation (an owner claim already present) but no
// ledger-identity.json yet: migration-required, old hostname-derived seed
// kept, and — the critical guarantee — nothing gets written silently.
const installC = freshDataDir('install-c');
fs.mkdirSync(path.join(installC, 'runtime'), { recursive: true });
fs.writeFileSync(
  path.join(installC, 'runtime', 'gateway-claims.json'),
  JSON.stringify({ gatewayId: 'test-gateway', owner: 'deadbeef'.repeat(8), admins: {}, grants: {}, pubkeys: {}, usernames: {} }, null, 2),
  'utf8',
);
const legacySeed = `netget-gateway:${os.hostname().toLowerCase()}`;
const installCResolution = withDataDir(installC, () => resolveLedgerIdentity());
assert.equal(installCResolution.requiresMigration, true, 'existing owner claim + no identity file must be flagged as migration-required');
assert.equal(installCResolution.isNew, false);
assert.equal(installCResolution.seedHex, legacySeed, 'a migration-pending installation must keep resolving to the old hostname-derived seed');
assert.ok(!fs.existsSync(path.join(installC, 'ledger-identity.json')), 'a migration-pending installation must NOT get a silently generated ledger-identity.json');

// 6b) Same guarantee via the other existing-installation signal: a legacy
// domains.db file, with no owner claim at all.
const installD = freshDataDir('install-d');
fs.writeFileSync(path.join(installD, 'domains.db'), '', 'utf8');
const installDResolution = withDataDir(installD, () => resolveLedgerIdentity());
assert.equal(installDResolution.requiresMigration, true, 'a legacy domains.db alone must also be treated as existing-installation state');
assert.ok(!fs.existsSync(path.join(installD, 'ledger-identity.json')));

// 7) A corrupted ledger-identity.json on an installation that ALSO has
// existing-installation state (an owner claim) must not fall back to the
// legacy hostname seed — that would silently swap this ledger's identity
// for a different one, not perform a migration. It must throw instead,
// and the corrupted file itself must be left alone (never silently
// overwritten or "fixed" by generating a new one over it).
const installE = freshDataDir('install-e');
fs.mkdirSync(path.join(installE, 'runtime'), { recursive: true });
fs.writeFileSync(
  path.join(installE, 'runtime', 'gateway-claims.json'),
  JSON.stringify({ gatewayId: 'test-gateway', owner: 'deadbeef'.repeat(8), admins: {}, grants: {}, pubkeys: {}, usernames: {} }, null, 2),
  'utf8',
);
fs.writeFileSync(path.join(installE, 'ledger-identity.json'), '{ not valid json', 'utf8');
const corruptedBeforeE = fs.readFileSync(path.join(installE, 'ledger-identity.json'), 'utf8');
assert.throws(
  () => withDataDir(installE, () => resolveLedgerIdentity()),
  /ledger-identity\.json.*(unreadable|corrupt)/i,
  'a corrupted identity file on an installation with existing state must halt startup, not fall back to the hostname seed',
);
const corruptedAfterE = fs.readFileSync(path.join(installE, 'ledger-identity.json'), 'utf8');
assert.equal(corruptedAfterE, corruptedBeforeE, 'a corrupted identity file must be left untouched, not silently regenerated');

// 7b) The same must hold even WITHOUT any legacy-installation signal
// present — the mere existence of a damaged ledger-identity.json is
// itself proof this installation once had a real persisted identity, so
// this must throw regardless of hasExistingInstallationState()'s result,
// not only when an owner claim happens to also be sitting there.
const installF = freshDataDir('install-f');
fs.writeFileSync(path.join(installF, 'ledger-identity.json'), '{ "seedHex": "too-short" }', 'utf8');
assert.throws(
  () => withDataDir(installF, () => resolveLedgerIdentity()),
  /ledger-identity\.json.*(unreadable|corrupt)/i,
  'a corrupted identity file must halt startup even with no other legacy-installation signal present',
);

// 8) The exact case this correction closes: a fresh install already has a
// real persisted identity; someone (or something) deletes ONLY
// ledger-identity.json, leaving the durable marker behind. That must NOT
// be treated as "never had one" — it must halt, not resolve to the
// hostname-derived seed and not generate a brand-new random identity
// either. Either of those would mean this ledger silently starts up as a
// different identity than the one it actually had.
const installG = freshDataDir('install-g');
const installGFirst = withDataDir(installG, () => resolveLedgerIdentity());
assert.equal(installGFirst.isNew, true);
const installGIdentityPath = path.join(installG, 'ledger-identity.json');
const installGMarkerPath = path.join(installG, 'ledger-identity.initialized.json');
assert.ok(fs.existsSync(installGIdentityPath));
assert.ok(fs.existsSync(installGMarkerPath));

fs.rmSync(installGIdentityPath);
assert.throws(
  () => withDataDir(installG, () => resolveLedgerIdentity()),
  /marker.*data loss|data loss.*marker/i,
  'deleting only the identity file (marker left in place) must halt startup, not fall back to the hostname seed or generate a new identity',
);
// Confirm it really didn't come back with a substitute identity of any
// kind, and didn't quietly recreate the file either.
assert.ok(!fs.existsSync(installGIdentityPath), 'the missing identity file must stay missing, not get silently regenerated');

console.log('ledger-identity ok');
