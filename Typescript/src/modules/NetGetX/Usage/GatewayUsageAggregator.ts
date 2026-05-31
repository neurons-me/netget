/**
 * @module GatewayUsageAggregator
 * @memberof module:NetGetX.Usage
 *
 * Reads and queries the `gateway-usage.json` snapshot produced by the Monad
 * resource bridge (`ResourceUsageLedger._exportToFile`).
 *
 * ## Data flow
 *
 * ```text
 * Surface request
 *   → recordSurfaceRequest()  (monad/surfaceTelemetry)
 *   → ResourceUsageLedger     (monad/resources/usageLedger)
 *       Level 1 → kernel ledger  surface.usage.requests
 *       Level 2 → kernel ledger  surface.usage.window
 *       Level 3 → gateway-usage.json   ← this module reads here
 *   → GatewayUsageAggregator  (netget)
 *       getSnapshot()
 *       getUsageByIdentity()
 *       getTotalRequests()
 *       …
 * ```
 *
 * ## Hot-reload
 *
 * `gateway-usage.version` is written atomically alongside `gateway-usage.json`.
 * Call {@link hasChanged} to check whether the snapshot has been updated since
 * the last read — same polling pattern as `domain-map.json`.
 *
 * ## Integration
 *
 * ```typescript
 * const agg = new GatewayUsageAggregator();
 *
 * // In your admin panel handler:
 * const snap = agg.read();
 * if (snap) {
 *     const bucket = agg.getUsageByIdentity(identityHash, snap);
 *     res.json({ requests: bucket?.requests ?? 0 });
 * }
 * ```
 *
 * @see {@link module:monad.resources.usageLedger}
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 */

import crypto from 'crypto';
import fs     from 'fs';
import path   from 'path';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

// ---------------------------------------------------------------------------
// Re-export types (keep schema definition in Monad; we mirror types here so
// NetGet consumers get proper TypeScript without importing from monad)
// ---------------------------------------------------------------------------

/** Per-identity (or anonymous) usage bucket for one window. */
export interface IdentityUsageBucket {
    requests:        number;
    totalDurationMs: number;
    avgDurationMs:   number;
    /** HTTP status code → count.  Keys are stringified numbers ("200", "404", …). */
    statusCodes:     Record<string, number>;
    /** Operation label → count. */
    operations:      Record<string, number>;
    /** Host name → count. */
    hosts:           Record<string, number>;
}

/** Shape of `gateway-usage.json`. */
export interface GatewayUsageSnapshot {
    gatewayId:       string;
    windowStartedAt: number;
    windowEndedAt:   number;
    totalRequests:   number;
    /** Requests attributed to a known `identityHash`. */
    identities:      Record<string, IdentityUsageBucket>;
    /** Requests with no `identityHash` (unauthenticated or pre-auth). */
    anonymous:       IdentityUsageBucket;
    byHost:          Record<string, number>;
    byOperation:     Record<string, number>;
    system: {
        cpuRatio:    number;
        memoryRatio: number;
        pressureCpu: number;
    };
    /** 32-char hex SHA-256 — change-detection signal. */
    version:   string;
    updatedAt: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Absolute path to `gateway-usage.json`.
 * Lives in `~/.get/runtime/` alongside `domain-map.json` and
 * `gateway-claims.json`.
 */
export function getGatewayUsagePath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'gateway-usage.json');
}

/**
 * Absolute path to the companion version file.
 * nginx Lua polls this file; a changed value triggers a hot-reload of
 * `gateway-usage.json` without a worker restart.
 */
export function getGatewayUsageVersionPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'gateway-usage.version');
}

// ---------------------------------------------------------------------------
// GatewayUsageAggregator
// ---------------------------------------------------------------------------

/**
 * Lightweight read-only accessor for the `gateway-usage.json` snapshot.
 *
 * All methods are synchronous and stateless — create instances freely or
 * keep a long-lived singleton.
 *
 * @example
 * ```typescript
 * const agg = new GatewayUsageAggregator();
 *
 * if (agg.hasChanged()) {
 *     const snap = agg.read();
 *     // …update in-memory cache…
 * }
 * ```
 */
export class GatewayUsageAggregator {
    private _lastVersion: string = '';

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Reads and parses `gateway-usage.json`.
     *
     * Returns `null` when the file does not exist or cannot be parsed.
     * A `null` result means Monad has not yet flushed a window snapshot,
     * or `NETGET_DATA_DIR` was not set when the daemon started.
     */
    read(): GatewayUsageSnapshot | null {
        try {
            const raw = fs.readFileSync(getGatewayUsagePath(), 'utf8');
            return JSON.parse(raw) as GatewayUsageSnapshot;
        } catch {
            return null;
        }
    }

    /**
     * Returns `true` when the on-disk snapshot has been updated since the last
     * call to {@link read} or {@link acknowledgeVersion}.
     *
     * Compares the version file against the last-seen version.  Useful for
     * building a polling loop that only re-reads when necessary.
     */
    hasChanged(): boolean {
        try {
            const v = fs.readFileSync(getGatewayUsageVersionPath(), 'utf8').trim();
            return v !== this._lastVersion;
        } catch {
            return false;
        }
    }

    /**
     * Marks the current on-disk version as seen — subsequent {@link hasChanged}
     * calls return `false` until the file is updated again.
     */
    acknowledgeVersion(): void {
        try {
            this._lastVersion = fs.readFileSync(getGatewayUsageVersionPath(), 'utf8').trim();
        } catch {
            this._lastVersion = '';
        }
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * Returns the usage bucket for `identityHash`, or `null` when that
     * identity has no entries in the current window.
     *
     * Pass a pre-loaded snapshot to avoid a redundant disk read.
     *
     * @example
     * ```typescript
     * const snap = agg.read();
     * const bucket = agg.getUsageByIdentity(identityHash, snap);
     * const requests = bucket?.requests ?? 0;
     * ```
     */
    getUsageByIdentity(
        identityHash: string,
        snap?: GatewayUsageSnapshot | null,
    ): IdentityUsageBucket | null {
        const s = snap ?? this.read();
        return s?.identities[identityHash] ?? null;
    }

    /**
     * Total request count across all identities and anonymous traffic for the
     * last flushed window.  Returns `0` when no snapshot is available.
     */
    getTotalRequests(snap?: GatewayUsageSnapshot | null): number {
        return (snap ?? this.read())?.totalRequests ?? 0;
    }

    /**
     * Returns the request count for a specific host, or `0` when unknown.
     *
     * @param host - e.g. `"local.netget"`, `"api.example.com"`
     */
    getRequestsByHost(host: string, snap?: GatewayUsageSnapshot | null): number {
        return (snap ?? this.read())?.byHost[host] ?? 0;
    }

    /**
     * Returns the request count for a specific operation label, or `0`.
     *
     * @param operation - e.g. `"read"`, `"write"`, `"delete"`
     */
    getRequestsByOperation(operation: string, snap?: GatewayUsageSnapshot | null): number {
        return (snap ?? this.read())?.byOperation[operation] ?? 0;
    }

    /**
     * Returns current system pressure metrics from the snapshot, or `null`.
     *
     * Useful for displaying a health indicator in the admin panel without
     * polling monad's `/__surface/events` SSE stream.
     */
    getSystemMetrics(snap?: GatewayUsageSnapshot | null): GatewayUsageSnapshot['system'] | null {
        return (snap ?? this.read())?.system ?? null;
    }

    /**
     * Returns all identities that appear in the current window's snapshot,
     * sorted by request count (descending).
     *
     * Useful for "top users by requests" views in the admin panel.
     */
    getTopIdentities(
        limit = 10,
        snap?: GatewayUsageSnapshot | null,
    ): Array<{ identityHash: string; bucket: IdentityUsageBucket }> {
        const s = snap ?? this.read();
        if (!s) return [];

        return Object.entries(s.identities)
            .sort(([, a], [, b]) => b.requests - a.requests)
            .slice(0, Math.max(1, limit))
            .map(([identityHash, bucket]) => ({ identityHash, bucket }));
    }

    /**
     * Verifies that the `version` field in a loaded snapshot matches the
     * `gateway-usage.version` file on disk.
     *
     * Returns `true` when the snapshot is fresh (not replaced between read
     * and verify).  Use this for optimistic-concurrency checks when acting
     * on snapshot data.
     */
    isSnapshotCurrent(snap: GatewayUsageSnapshot): boolean {
        try {
            const versionOnDisk = fs.readFileSync(getGatewayUsageVersionPath(), 'utf8').trim();
            return versionOnDisk === snap.version;
        } catch {
            return false;
        }
    }
}

// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------

/**
 * Process-wide usage aggregator instance.
 *
 * Import and call methods directly.  No initialisation needed — the aggregator
 * reads from disk on demand.
 *
 * @example
 * ```typescript
 * import { defaultUsageAggregator } from './Usage/GatewayUsageAggregator.js';
 *
 * const snap = defaultUsageAggregator.read();
 * const top  = defaultUsageAggregator.getTopIdentities(5, snap);
 * ```
 */
export const defaultUsageAggregator = new GatewayUsageAggregator();
