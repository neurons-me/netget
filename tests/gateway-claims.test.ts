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
} from '../src/modules/NetGetX/Auth/GatewayClaimsManager.ts';

// ---------------------------------------------------------------------------
// Redirect runtime dir to a temp directory so tests are fully isolated
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-claims-test-'));
process.env['NETGET_DATA_DIR'] = tmpDir;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh manager pointing at the isolated temp dir. */
function mgr(gatewayId = 'test.local') {
    return new GatewayClaimsManager(gatewayId);
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
    m.bootstrapOwner(OWNER);

    assert.equal(m.needsBootstrap(), false, 'no longer needs bootstrap after owner set');
    assert.equal(m.hasOwner(),       true);
    assert.equal(m.isOwner(OWNER),   true);
    assert.equal(m.isAdmin(OWNER),   true, 'owner is implicitly an admin');
    assert.deepEqual(m.getScopes(OWNER), FULL_ADMIN_SCOPES);

    // Snapshot file + version file should both exist
    assert.ok(fs.existsSync(getGatewayClaimsPath()),        'gateway-claims.json created');
    assert.ok(fs.existsSync(getGatewayClaimsVersionPath()), 'gateway-claims.version created');

    // Double-bootstrap must throw
    assert.throws(
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
    m.grantAdmin(ADMIN_2, ['domains:read', 'apps:read']);

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
    m.revokeAdmin(ADMIN_2);

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
    assert.throws(
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
    assert.throws(
        () => m.transferOwner(STRANGER),
        /not an admin/,
        'transferOwner to non-admin throws'
    );

    m.grantAdmin(ADMIN_2);
    m.transferOwner(ADMIN_2);

    assert.equal(m.isOwner(ADMIN_2), true,  'new owner after transfer');
    assert.equal(m.isOwner(OWNER),   false, 'previous owner no longer owner');
    assert.equal(m.isAdmin(OWNER),   true,  'previous owner retains admin access');
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
