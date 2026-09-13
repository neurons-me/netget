/**
 * Tests for GatewayClaimsManager.
 *
 * Covers:
 *   - hostname normalisation
 *   - empty snapshot creation
 *   - bootstrap detection and first-owner write
 *   - isOwner / isAdmin / getScopes / hasScope queries
 *   - grantAdmin / revokeAdmin mutations
 *   - owner-revoke guard
 *   - transferOwner
 *   - version stability (same payload → same hash)
 *   - atomic write + version-file bump
 */

import assert from 'node:assert/strict';
import fs     from 'node:fs';
import os     from 'node:os';
import path   from 'node:path';

import {
    GatewayClaimsManager,
    FULL_ADMIN_SCOPES,
    getGatewayClaimsPath,
    getGatewayClaimsVersionPath,
    type GatewayClaimsLedgerClient,
} from '../src/modules/NetGetX/Auth/GatewayClaimsManager.ts';

// ---------------------------------------------------------------------------
// Redirect runtime dir to a temp directory so tests are fully isolated
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-claims-test-'));
process.env['NETGET_DATA_DIR'] = tmpDir;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setDeepValue(target: Record<string, unknown>, pathInput: string, value: unknown): void {
    const parts = pathInput.split('.').filter(Boolean);
    let cursor = target;
    for (let i = 0; i < parts.length; i += 1) {
        const key = parts[i]!;
        if (i === parts.length - 1) {
            cursor[key] = value;
            return;
        }
        if (!isRecord(cursor[key])) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
    }
}

function deleteDeepValue(target: Record<string, unknown>, pathInput: string): void {
    const parts = pathInput.split('.').filter(Boolean);
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i]!;
        if (!isRecord(cursor[key])) return;
        cursor = cursor[key] as Record<string, unknown>;
    }
    delete cursor[parts[parts.length - 1]!];
}

function getDeepValue(target: unknown, pathInput: string): unknown {
    const parts = pathInput.split('.').filter(Boolean);
    let cursor = target;
    for (const part of parts) {
        if (!isRecord(cursor)) return undefined;
        cursor = cursor[part];
    }
    return cursor;
}

class InMemoryClaimsLedger implements GatewayClaimsLedgerClient {
    readonly writes: Array<{ path: string; value: unknown; operator?: '-' }> = [];
    readonly tree: Record<string, unknown> = {};

    async read(pathInput: string): Promise<unknown> {
        return JSON.parse(JSON.stringify(getDeepValue(this.tree, pathInput) ?? null));
    }

    async write(pathInput: string, value: unknown, operator?: '-'): Promise<void> {
        this.writes.push({ path: pathInput, value, operator });
        if (operator === '-') {
            deleteDeepValue(this.tree, pathInput);
        } else {
            setDeepValue(this.tree, pathInput, value);
        }
    }
}

/** Fresh manager pointing at the isolated temp dir. */
function mgr(gatewayId = 'test.local', ledger: GatewayClaimsLedgerClient | false = false) {
    return new GatewayClaimsManager(gatewayId, { ledger });
}

const OWNER   = 'aabbcc001122deadbeef0000000000000000000000000000000000000000000001';
const ADMIN_2 = 'aabbcc001122deadbeef0000000000000000000000000000000000000000000002';
const STRANGER = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff03';

// ---------------------------------------------------------------------------
// normalizeGatewayId
// ---------------------------------------------------------------------------

assert.equal(
    GatewayClaimsManager.normalizeGatewayId('Suis-MacBook-Air.local'),
    'suis-macbook-air.local',
    'normalise: uppercase → lowercase'
);

assert.equal(
    GatewayClaimsManager.normalizeGatewayId('  My Server  '),
    'my-server',
    'normalise: trims whitespace + collapses spaces to dash'
);

assert.equal(
    GatewayClaimsManager.normalizeGatewayId('already-lower.local'),
    'already-lower.local',
    'normalise: already-lowercase passthrough'
);

// ---------------------------------------------------------------------------
// empty snapshot
// ---------------------------------------------------------------------------

const empty = GatewayClaimsManager.empty('test.local');
assert.equal(empty.gatewayId, 'test.local');
assert.equal(empty.owner, null);
assert.deepEqual(empty.admins, {});
assert.deepEqual(empty.grants, {});
assert.ok(typeof empty.version === 'string' && empty.version.length === 32,
    'version is a 32-char hex string');

// ---------------------------------------------------------------------------
// needsBootstrap / hasOwner before writing anything
// ---------------------------------------------------------------------------

{
    const m = mgr();
    assert.equal(m.needsBootstrap(), true,  'needs bootstrap when no file exists');
    assert.equal(m.hasOwner(),       false, 'no owner when no file exists');
    assert.equal(m.isAdmin(OWNER),   false, 'not admin when no file exists');
}

// ---------------------------------------------------------------------------
// bootstrapOwner
// ---------------------------------------------------------------------------

{
    const m = mgr();
    await m.bootstrapOwner(OWNER);

    assert.equal(m.needsBootstrap(), false, 'no longer needs bootstrap after owner set');
    assert.equal(m.hasOwner(),       true);
    assert.equal(m.isOwner(OWNER),   true);
    assert.equal(m.isAdmin(OWNER),   true, 'owner is implicitly an admin');
    assert.deepEqual(m.getScopes(OWNER), FULL_ADMIN_SCOPES);

    // Snapshot file + version file should both exist
    assert.ok(fs.existsSync(getGatewayClaimsPath()),        'gateway-claims.json created');
    assert.ok(fs.existsSync(getGatewayClaimsVersionPath()), 'gateway-claims.version created');

    // Double-bootstrap must throw
    await assert.rejects(
        () => m.bootstrapOwner(ADMIN_2),
        /already has an owner/,
        'bootstrapOwner throws on already-bootstrapped gateway'
    );
}

// ---------------------------------------------------------------------------
// stranger has no access after bootstrap
// ---------------------------------------------------------------------------

{
    const m = mgr();
    assert.equal(m.isOwner(STRANGER),   false);
    assert.equal(m.isAdmin(STRANGER),   false);
    assert.deepEqual(m.getScopes(STRANGER), []);
    assert.equal(m.hasScope(STRANGER, 'domains:read'), false);
}

// ---------------------------------------------------------------------------
// grantAdmin + narrow scopes
// ---------------------------------------------------------------------------

{
    const m = mgr();
    await m.grantAdmin(ADMIN_2, ['domains:read', 'apps:read']);

    assert.equal(m.isAdmin(ADMIN_2), true);
    assert.equal(m.isOwner(ADMIN_2), false, 'grantAdmin does not make owner');
    assert.deepEqual(m.getScopes(ADMIN_2), ['domains:read', 'apps:read']);
    assert.equal(m.hasScope(ADMIN_2, 'domains:read'),  true);
    assert.equal(m.hasScope(ADMIN_2, 'domains:write'), false,
        'write scope not granted to narrow admin');
}

// ---------------------------------------------------------------------------
// revokeAdmin — non-owner
// ---------------------------------------------------------------------------

{
    const m = mgr();
    await m.revokeAdmin(ADMIN_2);

    assert.equal(m.isAdmin(ADMIN_2),       false, 'admin revoked');
    assert.deepEqual(m.getScopes(ADMIN_2), [],    'no scopes after revocation');

    // Owner must remain untouched
    assert.equal(m.isOwner(OWNER),  true, 'owner unaffected by revokeAdmin on other');
    assert.equal(m.isAdmin(OWNER),  true);
}

// ---------------------------------------------------------------------------
// revokeAdmin on owner → must throw
// ---------------------------------------------------------------------------

{
    const m = mgr();
    await assert.rejects(
        () => m.revokeAdmin(OWNER),
        /Cannot revoke the gateway owner/,
        'revokeAdmin on owner throws'
    );
}

// ---------------------------------------------------------------------------
// transferOwner
// ---------------------------------------------------------------------------

{
    const m = mgr();
    // transferOwner requires target to already be an admin
    await assert.rejects(
        () => m.transferOwner(STRANGER),
        /not an admin/,
        'transferOwner to non-admin throws'
    );

    await m.grantAdmin(ADMIN_2);
    await m.transferOwner(ADMIN_2);

    assert.equal(m.isOwner(ADMIN_2), true,  'new owner after transfer');
    assert.equal(m.isOwner(OWNER),   false, 'previous owner no longer owner');
    assert.equal(m.isAdmin(OWNER),   true,  'previous owner retains admin access');
}

// ---------------------------------------------------------------------------
// Semantic ledger write + snapshot materialisation
// ---------------------------------------------------------------------------

{
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const ledger = new InMemoryClaimsLedger();
    const m = mgr('ledger.local', ledger);

    await m.bootstrapOwner(OWNER, 'pub-owner', ['domains:read'], 'suign');
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.username'), 'suign');
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${OWNER}`), true);
    assert.deepEqual(getDeepValue(ledger.tree, `netget.grants.${OWNER}`), ['domains:read']);
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${OWNER}`), 'pub-owner');
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${OWNER}`), 'suign');
    assert.equal(m.read()?.owner, OWNER, 'snapshot materialised after bootstrap');

    await m.grantAdmin(ADMIN_2, 'pub-admin-2', ['apps:read'], 'ana');
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${ADMIN_2}`), true);
    assert.deepEqual(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), ['apps:read']);
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${ADMIN_2}`), 'pub-admin-2');
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${ADMIN_2}`), 'ana');

    await m.revokeAdmin(ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${ADMIN_2}`), undefined);

    await m.grantAdmin(ADMIN_2, 'pub-admin-2', ['gateway:read', 'gateway:write:domain-metadata'], 'ana');
    await m.transferOwner(ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.username'), 'ana');

    const materialised = await m.materializeFromLedger();
    assert.equal(materialised.owner, ADMIN_2);
    assert.equal(materialised.admins[OWNER], true, 'previous owner remains admin');
    assert.deepEqual(materialised.grants[ADMIN_2], ['gateway:read', 'gateway:write:domain-metadata']);
    assert.equal(materialised.usernames[ADMIN_2], 'ana');

    await m.reset();
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), undefined);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.username'), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${OWNER}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), undefined);
    assert.equal(m.needsBootstrap(), true, 'reset materialises an unowned snapshot');
}

// ---------------------------------------------------------------------------
// bootstrapOwner is ledger-authoritative -- not merely "local file happens
// to be absent". `this.read() ?? await this.readLedgerSnapshot()` (the
// pattern registerIdentity() still uses) only ever falls through to the
// ledger when read() returns exactly `null` -- never when it returns a
// parsed-but-owner-less snapshot object, which is the more realistic
// failure mode (a stale runtime dir, a fresh reinstall pointed at the same
// ledger). Both must be rejected identically whenever the ledger already
// shows an owner, and a ledger that can't even be read must fail closed
// (refuse to bootstrap), never be treated as "must mean no owner".
// ---------------------------------------------------------------------------

{
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const ledger = new InMemoryClaimsLedger();
    const seeded = mgr('locked.local', ledger);
    await seeded.bootstrapOwner(OWNER, 'pub-owner', undefined, 'first-owner');
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER, 'ledger seeded with an owner');

    // Case A: local snapshot file is genuinely ABSENT (fresh install, or a
    // wiped runtime dir pointed back at the same already-owned ledger).
    fs.rmSync(getGatewayClaimsPath(), { force: true });
    fs.rmSync(getGatewayClaimsVersionPath(), { force: true });
    const freshInstall = mgr('locked.local', ledger);
    assert.equal(freshInstall.read(), null, 'local snapshot file must be genuinely gone for this case');
    await assert.rejects(
        () => freshInstall.bootstrapOwner(ADMIN_2, 'pub-attacker', undefined, 'second-claimant'),
        /already has an owner/,
        'bootstrapOwner must consult the ledger and reject even with no local snapshot at all'
    );

    // Case B: local snapshot file EXISTS but is owner-less -- a stale or
    // hand-emptied file. This is the exact case the `??` pattern would
    // have silently trusted instead of ever checking the ledger.
    const staleEmpty = GatewayClaimsManager.empty('locked.local');
    fs.mkdirSync(path.dirname(getGatewayClaimsPath()), { recursive: true });
    fs.writeFileSync(getGatewayClaimsPath(), JSON.stringify(staleEmpty, null, 2), 'utf8');
    const staleInstall = mgr('locked.local', ledger);
    assert.equal(staleInstall.read()?.owner, null, 'local snapshot exists but genuinely has no owner');
    await assert.rejects(
        () => staleInstall.bootstrapOwner(ADMIN_2, 'pub-attacker', undefined, 'second-claimant'),
        /already has an owner/,
        'bootstrapOwner must reject even when a present local snapshot merely lacks an owner'
    );

    // Both rejected attempts must leave the ledger itself untouched.
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER, 'ledger owner unchanged after rejected re-bootstrap attempts');
}

{
    class ThrowingLedger implements GatewayClaimsLedgerClient {
        async read(): Promise<unknown> { throw new Error('simulated ledger outage'); }
        async write(): Promise<void> { throw new Error('should not be reached — bootstrapOwner must fail before any write'); }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const m = mgr('outage.local', new ThrowingLedger());
    await assert.rejects(
        () => m.bootstrapOwner(OWNER),
        /Could not verify against the ledger/,
        'bootstrapOwner fails closed when the ledger itself cannot be read, never treating an unreadable ledger as "no owner"'
    );
}

// ---------------------------------------------------------------------------
// registerIdentity — ledger-backed replacement for claim_identity.lua writes
// ---------------------------------------------------------------------------

{
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const ledger = new InMemoryClaimsLedger();
    const m = mgr('claim.local', ledger);

    const bootstrapped = await m.registerIdentity(OWNER, 'pub-owner', 'suign');
    assert.equal(bootstrapped.owner, OWNER, 'first registered identity becomes owner');
    assert.equal(bootstrapped.admins[OWNER], true, 'first registered identity becomes admin');
    assert.deepEqual(bootstrapped.grants[OWNER], FULL_ADMIN_SCOPES);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER);
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${OWNER}`), 'pub-owner');
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${OWNER}`), 'suign');

    const later = await m.registerIdentity(ADMIN_2, 'pub-admin-2', 'ana');
    assert.equal(later.owner, OWNER, 'later registered identity does not replace owner');
    assert.equal(later.admins[ADMIN_2], undefined, 'later registered identity is not an admin');
    assert.deepEqual(later.grants[ADMIN_2] ?? [], [], 'later registered identity gets no scopes');
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${ADMIN_2}`), 'pub-admin-2');
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${ADMIN_2}`), 'ana');
    assert.equal(m.read()?.pubkeys[ADMIN_2], 'pub-admin-2', 'snapshot is materialized');
}

// ---------------------------------------------------------------------------
// materializeFromNamespaceClaim bootstrap + grantAdmin/revokeAdmin/
// transferOwner ledger coherence.
//
// materializeFromNamespaceClaim() is deliberately ledger-free (see its own
// doc comment) — it only ever writes the local snapshot file. Every other
// mutation (grantAdmin/revokeAdmin/transferOwner) still goes through the
// OLD ledger-first model: commitSnapshot() -> writeLedger() ->
// materializeFromLedger(). gatewayClaimsSnapshotToLedgerEntries() is NOT a
// true diff against the ledger's own state — it unconditionally re-asserts
// every field of the NEXT snapshot, using the passed `previousSnapshot`
// (always the LOCAL file, never the ledger's own branch) only to compute
// deletions. So the first ledger-touching call after a
// materializeFromNamespaceClaim()-only bootstrap silently backfills the
// ledger with the bootstrapped identity's full state as a side effect —
// this is relied upon, not accidental (see the doc comment added on
// commitSnapshot() in GatewayClaimsManager.ts). This block locks that in.
// ---------------------------------------------------------------------------

{
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const ledger = new InMemoryClaimsLedger();
    const m = mgr('namespace-claim.local', ledger);

    // Bootstrap via the namespace-derived path: local file only, ledger
    // genuinely untouched — this is the whole point of that method.
    m.materializeFromNamespaceClaim({ identityHash: OWNER, publicKey: 'pub-owner', username: 'suign' });
    assert.equal(m.read()?.owner, OWNER, 'local snapshot bound to OWNER');
    assert.equal(Object.keys(ledger.tree).length, 0, 'materializeFromNamespaceClaim never touches the ledger');

    // grantAdmin is the first ledger-touching call. It must backfill the
    // ORIGINAL (namespace-derived) owner's full state into the ledger, not
    // just write the new grant in isolation.
    await m.grantAdmin(ADMIN_2, 'pub-admin-2', ['apps:read'], 'ana');
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER, 'ledger backfilled with the namespace-derived owner');
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.username'), 'suign', "ledger backfilled with the owner's username");
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${OWNER}`), true, 'ledger backfilled with the owner admin entry');
    assert.deepEqual(getDeepValue(ledger.tree, `netget.grants.${OWNER}`), FULL_ADMIN_SCOPES, "ledger backfilled with the owner's full scopes");
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${OWNER}`), 'pub-owner', 'ledger backfilled with the owner pubkey');
    // ...alongside the actual new grant.
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${ADMIN_2}`), true);
    assert.deepEqual(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), ['apps:read']);
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${ADMIN_2}`), 'ana');
    assert.equal(m.read()?.admins[ADMIN_2], true, 'local file stays consistent with the ledger');

    // The owner-cannot-be-revoked invariant must hold under this bootstrap
    // path too — not just the old bootstrapOwner()-seeded one.
    await assert.rejects(
        () => m.revokeAdmin(OWNER),
        /Cannot revoke the gateway owner/,
        'owner cannot be revoked even when bootstrapped via materializeFromNamespaceClaim'
    );

    await m.revokeAdmin(ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${ADMIN_2}`), undefined, 'revoke removes the admin entry from the ledger');
    assert.equal(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.pubkeys.${ADMIN_2}`), undefined);
    assert.equal(m.read()?.admins[ADMIN_2], undefined, 'local file consistent after revoke');

    // transferOwner: re-grant ADMIN_2, then transfer. The ledger's owner
    // fields must reflect the transfer, and the namespace-derived original
    // owner (long since backfilled above) remains an admin in the ledger.
    await m.grantAdmin(ADMIN_2, 'pub-admin-2', ['gateway:read'], 'ana');
    await m.transferOwner(ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), ADMIN_2);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.username'), 'ana');
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${OWNER}`), true, 'namespace-derived original owner remains admin in the ledger after transfer');
    assert.equal(m.read()?.owner, ADMIN_2);
    assert.equal(m.read()?.admins[OWNER], true);
}

// ---------------------------------------------------------------------------
// revokeAdmin as the very FIRST ledger-touching call after a
// materializeFromNamespaceClaim() bootstrap: the target identity is present
// in the LOCAL file (seeded directly, simulating a legacy/restored local
// snapshot) but the ledger has never heard of this gateway at all — so the
// deletion path (`netget.admins.<id>`, `netget.grants.<id>`, ...) does not
// exist anywhere in the ledger tree yet. The delete must be a silent no-op,
// never a throw, and the backfill of the surviving owner data must still
// happen in the same call.
// ---------------------------------------------------------------------------

{
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const ledger = new InMemoryClaimsLedger();
    const m = mgr('legacy-local.local', ledger);

    // Seed the local file directly (not through grantAdmin) so the ledger
    // is left completely empty — the extra admin exists ONLY locally.
    m.write({
        ...GatewayClaimsManager.empty('legacy-local.local'),
        owner: OWNER,
        admins: { [OWNER]: true, [ADMIN_2]: true },
        grants: { [OWNER]: FULL_ADMIN_SCOPES, [ADMIN_2]: ['apps:read'] },
        pubkeys: { [OWNER]: 'pub-owner' },
        usernames: { [OWNER]: 'suign', [ADMIN_2]: 'ana' },
    });
    assert.equal(Object.keys(ledger.tree).length, 0, 'ledger has never been written to for this gateway');

    await m.revokeAdmin(ADMIN_2);

    assert.equal(getDeepValue(ledger.tree, `netget.admins.${ADMIN_2}`), undefined, 'deleting a path the ledger never had is a silent no-op');
    assert.equal(getDeepValue(ledger.tree, `netget.grants.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, `netget.usernames.${ADMIN_2}`), undefined);
    assert.equal(getDeepValue(ledger.tree, 'netget.owner.identityHash'), OWNER, 'the surviving owner is backfilled in the same call');
    assert.equal(getDeepValue(ledger.tree, `netget.admins.${OWNER}`), true);
    assert.equal(m.read()?.admins[ADMIN_2], undefined, 'local file no longer has the revoked admin');
}

// ---------------------------------------------------------------------------
// Version stability — identical payload → identical version hash
// ---------------------------------------------------------------------------

{
    const base = { gatewayId: 'test.local', owner: OWNER, admins: { [OWNER]: true as const }, grants: { [OWNER]: FULL_ADMIN_SCOPES } };
    const v1 = GatewayClaimsManager.computeVersion(base);
    const v2 = GatewayClaimsManager.computeVersion(base);
    assert.equal(v1, v2, 'same payload → same version hash');
}

// ---------------------------------------------------------------------------
// Version changes when payload changes
// ---------------------------------------------------------------------------

{
    const base1 = { gatewayId: 'test.local', owner: OWNER,   admins: { [OWNER]: true as const },   grants: { [OWNER]: FULL_ADMIN_SCOPES } };
    const base2 = { gatewayId: 'test.local', owner: ADMIN_2, admins: { [ADMIN_2]: true as const }, grants: { [ADMIN_2]: FULL_ADMIN_SCOPES } };
    assert.notEqual(
        GatewayClaimsManager.computeVersion(base1),
        GatewayClaimsManager.computeVersion(base2),
        'different payload → different version hash'
    );
}

// ---------------------------------------------------------------------------
// Atomic write: version file content matches snapshot version field
// ---------------------------------------------------------------------------

{
    const m = mgr();
    const snap = m.read()!;
    const versionOnDisk = fs.readFileSync(getGatewayClaimsVersionPath(), 'utf8');
    assert.equal(versionOnDisk, snap.version, 'version file matches snapshot.version');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('gateway-claims ok');
