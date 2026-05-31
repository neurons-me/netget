/**
 * Tests for GatewayUsageAggregator.
 *
 * Covers:
 *   - read() returns null when no file exists
 *   - read() parses a written snapshot correctly
 *   - hasChanged() / acknowledgeVersion() version tracking
 *   - getUsageByIdentity() — known hash, unknown hash, null
 *   - getTotalRequests()
 *   - getRequestsByHost() / getRequestsByOperation()
 *   - getSystemMetrics()
 *   - getTopIdentities() — sorted by requests, limit enforced
 *   - isSnapshotCurrent() — matches / mismatches version file
 *
 * The test writes snapshot fixtures directly to the temp dir — it does NOT
 * depend on the Monad bridge being running.
 */

import assert from 'node:assert/strict';
import fs     from 'node:fs';
import os     from 'node:os';
import path   from 'node:path';

import {
    GatewayUsageAggregator,
    getGatewayUsagePath,
    getGatewayUsageVersionPath,
    type GatewayUsageSnapshot,
} from '../src/modules/NetGetX/Usage/GatewayUsageAggregator.ts';

// ---------------------------------------------------------------------------
// Isolate to a temp directory
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-usage-test-'));
process.env['NETGET_DATA_DIR'] = tmpDir;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const OWNER = 'aabbcc001122deadbeef0000000000000000000000000000000000000000000001';
const ADMIN = 'aabbcc001122deadbeef0000000000000000000000000000000000000000000002';

function makeBucket(requests: number, durationMs = 50): GatewayUsageSnapshot['anonymous'] {
    return {
        requests,
        totalDurationMs: requests * durationMs,
        avgDurationMs:   durationMs,
        statusCodes:     { '200': requests },
        operations:      { read: requests },
        hosts:           { 'local.netget': requests },
    };
}

function writeSnapshot(snap: GatewayUsageSnapshot): void {
    const runtimeDir = path.join(tmpDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(getGatewayUsagePath(),        JSON.stringify(snap, null, 2), 'utf8');
    fs.writeFileSync(getGatewayUsageVersionPath(), snap.version,                 'utf8');
}

function makeSnapshot(overrides: Partial<GatewayUsageSnapshot> = {}): GatewayUsageSnapshot {
    const now = Date.now();
    return {
        gatewayId:       'test.local',
        windowStartedAt: now - 10_000,
        windowEndedAt:   now,
        totalRequests:   12,
        identities: {
            [OWNER]: makeBucket(8, 40),
            [ADMIN]: makeBucket(4, 60),
        },
        anonymous:   makeBucket(0),
        byHost:      { 'local.netget': 12 },
        byOperation: { read: 10, write: 2 },
        system: { cpuRatio: 0.15, memoryRatio: 0.30, pressureCpu: 0.15 },
        version:   'abcdef0123456789abcdef0123456789',
        updatedAt: now,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// read()
// ---------------------------------------------------------------------------

{
    const agg = new GatewayUsageAggregator();
    // File doesn't exist yet (we set the env but haven't written anything)
    // Clear any leftover files first
    try { fs.unlinkSync(getGatewayUsagePath()); } catch { /* ok */ }

    assert.equal(agg.read(), null, 'read() returns null when file does not exist');
}

{
    const snap = makeSnapshot();
    writeSnapshot(snap);

    const agg = new GatewayUsageAggregator();
    const loaded = agg.read()!;

    assert.ok(loaded !== null, 'read() returns snapshot when file exists');
    assert.equal(loaded.gatewayId,     snap.gatewayId);
    assert.equal(loaded.totalRequests, snap.totalRequests);
    assert.equal(loaded.version,       snap.version);
    assert.ok(typeof loaded.system.cpuRatio === 'number', 'system.cpuRatio is a number');
}

// ---------------------------------------------------------------------------
// hasChanged() / acknowledgeVersion()
// ---------------------------------------------------------------------------

{
    const agg = new GatewayUsageAggregator();
    const snap = makeSnapshot({ version: 'v1v1v1v1v1v1v1v1v1v1v1v1v1v1v1v' });
    writeSnapshot(snap);

    assert.equal(agg.hasChanged(), true, 'hasChanged() is true before acknowledgeVersion');

    agg.acknowledgeVersion();

    assert.equal(agg.hasChanged(), false, 'hasChanged() is false after acknowledgeVersion');

    // Write a new snapshot with different version
    writeSnapshot(makeSnapshot({ version: 'v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v' }));

    assert.equal(agg.hasChanged(), true, 'hasChanged() is true after new snapshot written');
}

// ---------------------------------------------------------------------------
// getUsageByIdentity()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot();
    writeSnapshot(snap);
    const agg = new GatewayUsageAggregator();

    const ownerBucket = agg.getUsageByIdentity(OWNER, snap);
    assert.ok(ownerBucket !== null, 'owner identity found');
    assert.equal(ownerBucket!.requests, 8);
    assert.equal(ownerBucket!.avgDurationMs, 40);

    const adminBucket = agg.getUsageByIdentity(ADMIN, snap);
    assert.ok(adminBucket !== null, 'admin identity found');
    assert.equal(adminBucket!.requests, 4);

    const unknownBucket = agg.getUsageByIdentity('unknown-hash', snap);
    assert.equal(unknownBucket, null, 'unknown identity returns null');
}

// ---------------------------------------------------------------------------
// getTotalRequests()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot({ totalRequests: 42 });
    writeSnapshot(snap);
    const agg = new GatewayUsageAggregator();

    // Passing a pre-loaded snapshot returns its totalRequests
    assert.equal(agg.getTotalRequests(snap), 42, 'returns totalRequests from pre-loaded snapshot');

    // Passing null falls through to disk read (same result)
    assert.equal(agg.getTotalRequests(null), 42, 'null falls through to disk read');

    // No file → returns 0
    fs.unlinkSync(getGatewayUsagePath());
    assert.equal(agg.getTotalRequests(), 0, 'returns 0 when no file exists');

    // Re-write for subsequent tests
    writeSnapshot(makeSnapshot());
}

// ---------------------------------------------------------------------------
// getRequestsByHost() / getRequestsByOperation()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot();
    const agg  = new GatewayUsageAggregator();

    assert.equal(agg.getRequestsByHost('local.netget', snap), 12);
    assert.equal(agg.getRequestsByHost('unknown.host', snap), 0);

    assert.equal(agg.getRequestsByOperation('read',   snap), 10);
    assert.equal(agg.getRequestsByOperation('write',  snap), 2);
    assert.equal(agg.getRequestsByOperation('delete', snap), 0);
}

// ---------------------------------------------------------------------------
// getSystemMetrics()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot();
    const agg  = new GatewayUsageAggregator();
    const sys  = agg.getSystemMetrics(snap)!;

    assert.ok(sys !== null, 'system metrics not null');
    assert.equal(sys.cpuRatio,    0.15);
    assert.equal(sys.memoryRatio, 0.30);
    assert.equal(sys.pressureCpu, 0.15);

    // null falls through to disk read — returns valid metrics when file exists
    assert.ok(agg.getSystemMetrics(null) !== null, 'null falls through to disk read');
}

// ---------------------------------------------------------------------------
// getTopIdentities()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot();
    const agg  = new GatewayUsageAggregator();
    const top  = agg.getTopIdentities(10, snap);

    assert.ok(top.length >= 2, 'at least two identities returned');
    // First entry must have the most requests (OWNER with 8 > ADMIN with 4)
    assert.equal(top[0]!.identityHash, OWNER,   'top identity is the one with most requests');
    assert.equal(top[0]!.bucket.requests, 8);
    assert.equal(top[1]!.identityHash, ADMIN);
    assert.equal(top[1]!.bucket.requests, 4);
}

{
    // limit = 1
    const snap = makeSnapshot();
    const agg  = new GatewayUsageAggregator();
    const top  = agg.getTopIdentities(1, snap);
    assert.equal(top.length, 1, 'limit=1 returns only 1 entry');
    assert.equal(top[0]!.identityHash, OWNER);
}

// ---------------------------------------------------------------------------
// isSnapshotCurrent()
// ---------------------------------------------------------------------------

{
    const snap = makeSnapshot();
    writeSnapshot(snap);
    const agg = new GatewayUsageAggregator();

    assert.equal(agg.isSnapshotCurrent(snap), true,
        'isSnapshotCurrent returns true when version matches file');

    // Tamper version field — now it differs from the version file
    const stale = { ...snap, version: 'stale0000000000000000000000000000' };
    assert.equal(agg.isSnapshotCurrent(stale), false,
        'isSnapshotCurrent returns false when version does not match file');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('gateway-usage-aggregator ok');
