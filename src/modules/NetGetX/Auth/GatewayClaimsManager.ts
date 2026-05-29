/**
 * @module GatewayClaimsManager
 * @memberof module:NetGetX.Auth
 *
 * Manages the local authorisation snapshot for the NetGet admin panel.
 *
 * ## Architecture overview
 *
 * Authentication in `local.netget` is built on three layers:
 *
 *   1. **Sovereign identity** — `.me` / Cleaker.  The operator proves ownership
 *      of a namespace with an Ed25519 challenge-response (`me.prove()`).
 *      Monad verifies the proof via `POST /claims/signIn`.
 *
 *   2. **Gateway claims ledger** — semantic entries written to the monad ledger
 *      under the canonical path `netget.<gatewayId>.*`.  This is the durable
 *      source of truth for who administers this gateway.
 *
 *   3. **Local claims snapshot** — `~/.netget/runtime/gateway-claims.json`.
 *      A materialised, atomically-written JSON derived from the ledger.
 *      nginx / Lua reads this file (with a version-bump hot-reload, identical to
 *      `domain-map.json`) so it can make auth decisions without a per-request
 *      roundtrip to monad.
 *
 * ## Ledger paths
 *
 * ```
 * netget.<gatewayId>.meta.owner                 → <identityHash>   (string)
 * netget.<gatewayId>.admins.<identityHash>       → true             (boolean)
 * netget.<gatewayId>.grants.<identityHash>.scope → string[]
 * ```
 *
 * ## Bootstrap sequence
 *
 * On first `netget ON`:
 *   1. CLI detects `needsBootstrap() === true` (no owner in snapshot).
 *   2. Operator proves `.me` identity → `identityHash` obtained.
 *   3. `bootstrapOwner(identityHash)` writes owner + admin + full scopes.
 *   4. Snapshot is flushed → nginx picks it up automatically.
 *   5. All subsequent admin grants go through an existing admin's session.
 *
 * ## Lua consumption
 *
 * nginx reads `gateway-claims.json` with a 1-second polling timer (same
 * mechanism as `domain-map.json`).  Auth checks are O(1) key lookups in the
 * in-memory table.  The version file (`gateway-claims.version`) signals workers
 * to reload without a full nginx restart.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsSnapshot}
 */

import crypto from 'crypto';
import fs     from 'fs';
import os     from 'os';
import path   from 'path';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively sorts all keys of plain objects so that JSON.stringify always
 * produces the same canonical string regardless of insertion order.
 * Arrays and primitives are returned as-is.
 */
function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (value !== null && typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}

// ---------------------------------------------------------------------------
// Scope definitions
// ---------------------------------------------------------------------------

/**
 * Granular permission scopes granted to an admin identity.
 *
 * Format: `<resource>:<level>`
 *   - `read`  — list / inspect
 *   - `write` — create / update / delete
 *
 * A super-admin holds all scopes; delegated grants may be narrowed.
 */
export type GatewayScope =
    | 'domains:read'  | 'domains:write'
    | 'apps:read'     | 'apps:write'
    | 'routes:read'   | 'routes:write'
    | 'gateway:read'  | 'gateway:write';

/**
 * Full set of scopes granted to the gateway owner.
 * Delegated admins may receive a subset.
 */
export const FULL_ADMIN_SCOPES: GatewayScope[] = [
    'domains:read',  'domains:write',
    'apps:read',     'apps:write',
    'routes:read',   'routes:write',
    'gateway:read',  'gateway:write',
];

// ---------------------------------------------------------------------------
// Snapshot schema
// ---------------------------------------------------------------------------

/**
 * The materialised claims snapshot written to disk and consumed by nginx Lua.
 *
 * Fields are kept flat and denormalised for O(1) Lua reads — no joins needed.
 */
export interface GatewayClaimsSnapshot {
    /** Normalised gateway identifier derived from the host's hostname. */
    gatewayId: string;

    /**
     * `identityHash` of the gateway owner — the first identity that bootstrapped
     * this gateway.  `null` when no owner has been set (needs bootstrap).
     */
    owner: string | null;

    /**
     * Map of `identityHash → true` for every identity with admin access.
     * The owner is always included here after bootstrap.
     */
    admins: Record<string, true>;

    /**
     * Map of `identityHash → GatewayScope[]`.
     * Grants define what each admin can do beyond simple authentication.
     */
    grants: Record<string, GatewayScope[]>;

    /**
     * Map of `identityHash → Ed25519 public key (base64url, 32 bytes raw)`.
     *
     * Written during `netget claim` via `bootstrapOwner(identityHash, pubkey)`.
     * nginx Lua uses this for challenge-response verification in `/me/auth`.
     *
     * Key is the same deterministic Ed25519 key derived by Cleaker via:
     *   HKDF(compoundSeed, "me.prove.v1", expression) → 32-byte signing seed
     * so it rotates only if the user changes their seed phrase.
     *
     * Gateways anchored before this field was added will have an empty map;
     * Lua falls back to legacy hash comparison in that case.
     */
    pubkeys: Record<string, string>;

    /**
     * SHA-256 of the canonical (sorted-keys) JSON of the payload fields.
     * Used by nginx Lua as a change-detection signal — identical to the
     * `domain-map.version` mechanism.
     */
    version: string;

    /** Unix epoch milliseconds of the last write. */
    updatedAt: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to `gateway-claims.json`.
 * Always lives under `~/.netget/runtime/` alongside `domain-map.json`.
 */
export function getGatewayClaimsPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'gateway-claims.json');
}

/**
 * Returns the absolute path to the companion version file.
 * nginx Lua polls this file every second; a content change triggers an
 * in-memory reload of `gateway-claims.json` — no worker restart needed.
 */
export function getGatewayClaimsVersionPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'gateway-claims.version');
}

// ---------------------------------------------------------------------------
// GatewayClaimsManager
// ---------------------------------------------------------------------------

/**
 * Reads, writes, and queries the local gateway claims snapshot.
 *
 * Instances are lightweight (no persistent state beyond the gateway ID).
 * Create one per operation or keep a long-lived instance — both are safe.
 *
 * @example
 * ```typescript
 * const mgr = new GatewayClaimsManager();
 *
 * if (mgr.needsBootstrap()) {
 *     mgr.bootstrapOwner(identityHashFromMeProof);
 * }
 *
 * if (mgr.isAdmin(incomingIdentityHash)) {
 *     const scopes = mgr.getScopes(incomingIdentityHash);
 *     // proceed with scoped access
 * }
 * ```
 */
export class GatewayClaimsManager {
    readonly gatewayId: string;

    constructor(gatewayId?: string) {
        this.gatewayId = gatewayId ?? GatewayClaimsManager.normalizeGatewayId(os.hostname());
    }

    // ── Static helpers ────────────────────────────────────────────────────

    /**
     * Derives a canonical, URL-safe gateway identifier from an OS hostname.
     *
     * Rules applied in order:
     *   1. Trim whitespace
     *   2. Lowercase
     *   3. Replace runs of whitespace with `-`
     *
     * The raw hostname is used as-is beyond that (macOS `.local` suffix,
     * DNS labels, etc. are left intact so the ID matches what nginx and
     * mDNS already know about this host).
     *
     * @example
     * ```typescript
     * normalizeGatewayId('Suis-MacBook-Air.local') // → 'suis-macbook-air.local'
     * normalizeGatewayId('  My Server  ')           // → 'my-server'
     * ```
     */
    static normalizeGatewayId(hostname: string): string {
        return hostname.trim().toLowerCase().replace(/\s+/g, '-');
    }

    /**
     * Computes a stable SHA-256 version string from a snapshot's payload.
     * Keys are sorted before serialisation so equivalent snapshots always
     * produce the same hash regardless of insertion order.
     *
     * @returns Hex-encoded SHA-256 of the canonical JSON (first 16 bytes = 32 hex chars).
     */
    static computeVersion(snapshot: Omit<GatewayClaimsSnapshot, 'version' | 'updatedAt'>): string {
        const stable = JSON.stringify(sortKeysDeep(snapshot));
        return crypto.createHash('sha256').update(stable, 'utf8').digest('hex').slice(0, 32);
    }

    /**
     * Returns an empty snapshot with no owner and no admins.
     * Used as the starting point for bootstrap.
     */
    static empty(gatewayId: string): GatewayClaimsSnapshot {
        const base = { gatewayId, owner: null, admins: {}, grants: {}, pubkeys: {} };
        return {
            ...base,
            version: GatewayClaimsManager.computeVersion(base),
            updatedAt: Date.now(),
        };
    }

    // ── Read ──────────────────────────────────────────────────────────────

    /**
     * Reads and parses `gateway-claims.json` from disk.
     *
     * Returns `null` when the file does not exist or cannot be parsed — callers
     * should treat `null` the same as `needsBootstrap() === true`.
     */
    read(): GatewayClaimsSnapshot | null {
        try {
            const raw = fs.readFileSync(getGatewayClaimsPath(), 'utf8');
            return JSON.parse(raw) as GatewayClaimsSnapshot;
        } catch {
            return null;
        }
    }

    // ── Write ─────────────────────────────────────────────────────────────

    /**
     * Atomically writes `snapshot` to disk and bumps the version file.
     *
     * Write sequence (mirrors `domain-map.json`):
     *   1. Serialise to `<path>.tmp`
     *   2. `rename()` — atomic on POSIX; nginx never sees a partial file
     *   3. Write the version file — this is what triggers Lua hot-reload
     *
     * @throws If the runtime directory cannot be created or the write fails.
     */
    write(snapshot: GatewayClaimsSnapshot): void {
        const outPath     = getGatewayClaimsPath();
        const versionPath = getGatewayClaimsVersionPath();
        const tmpPath     = `${outPath}.tmp`;

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
        fs.renameSync(tmpPath, outPath);

        // Version bump — Lua workers detect the change and hot-reload the table.
        fs.writeFileSync(versionPath, snapshot.version, 'utf8');
    }

    // ── Bootstrap detection ───────────────────────────────────────────────

    /**
     * Returns `true` when no owner has been set on this gateway.
     *
     * This is the primary guard for the CLI setup wizard: if `needsBootstrap()`
     * is true, the operator must prove a `.me` identity before the admin panel
     * becomes usable.
     */
    needsBootstrap(): boolean {
        return !this.hasOwner();
    }

    /**
     * Returns `true` when an owner identity is recorded in the snapshot.
     */
    hasOwner(): boolean {
        return typeof this.read()?.owner === 'string';
    }

    // ── Identity queries ──────────────────────────────────────────────────

    /**
     * Returns `true` when `identityHash` matches the gateway owner.
     *
     * Comparison is exact string equality (both are hex hashes — case matters).
     */
    isOwner(identityHash: string): boolean {
        return this.read()?.owner === identityHash;
    }

    /**
     * Returns `true` when `identityHash` appears in the `admins` map.
     *
     * The gateway owner is always an admin after bootstrap.
     * Delegated admins added via {@link grantAdmin} are also `true` here.
     */
    isAdmin(identityHash: string): boolean {
        return this.read()?.admins[identityHash] === true;
    }

    /**
     * Returns the list of {@link GatewayScope}s granted to `identityHash`.
     *
     * Returns an empty array when the identity is unknown or has no explicit
     * grants — callers should treat an empty array as "no access".
     */
    getScopes(identityHash: string): GatewayScope[] {
        return this.read()?.grants[identityHash] ?? [];
    }

    /**
     * Returns `true` when `identityHash` has been granted the given `scope`.
     *
     * @example
     * ```typescript
     * if (!mgr.hasScope(idHash, 'domains:write')) {
     *     return res.status(403).json({ error: 'SCOPE_REQUIRED', scope: 'domains:write' });
     * }
     * ```
     */
    hasScope(identityHash: string, scope: GatewayScope): boolean {
        return this.getScopes(identityHash).includes(scope);
    }

    // ── Mutations ─────────────────────────────────────────────────────────

    /**
     * Records the first-ever admin identity on this gateway.
     *
     * **Must only be called when `needsBootstrap() === true`.**
     * Calling on an already-bootstrapped gateway throws to prevent accidental
     * owner replacement.
     *
     * The bootstrapping identity is simultaneously set as:
     *   - `owner`
     *   - entry in `admins`
     *   - entry in `grants` with `scopes` (defaults to {@link FULL_ADMIN_SCOPES})
     *   - entry in `pubkeys` with the Ed25519 public key (if provided)
     *
     * @param identityHash - Identity hash derived from `.me` credentials.
     * @param pubkey       - Ed25519 public key (base64url) for challenge-response auth.
     *                       Pass `null` / omit on legacy bootstraps (hash-only auth).
     * @param scopes       - Scopes to grant; defaults to full admin scopes.
     *
     * @throws If bootstrap has already been performed.
     */
    bootstrapOwner(
        identityHash: string,
        pubkey:  string | null = null,
        scopes: GatewayScope[] = FULL_ADMIN_SCOPES,
    ): void {
        if (this.hasOwner()) {
            throw new Error(
                `Gateway "${this.gatewayId}" already has an owner. ` +
                'Use grantAdmin() to add additional admins.'
            );
        }
        const pubkeys: Record<string, string> = pubkey ? { [identityHash]: pubkey } : {};
        const base: Omit<GatewayClaimsSnapshot, 'version' | 'updatedAt'> = {
            gatewayId: this.gatewayId,
            owner:     identityHash,
            admins:    { [identityHash]: true },
            grants:    { [identityHash]: scopes },
            pubkeys,
        };
        this.write({
            ...base,
            version:   GatewayClaimsManager.computeVersion(base),
            updatedAt: Date.now(),
        });
    }

    /**
     * Grants admin access to an additional identity.
     *
     * The current snapshot is read, mutated, and atomically re-written.
     * Idempotent: calling with an already-granted identity updates its scopes.
     *
     * Accepts two call signatures for backward compatibility:
     *   - `grantAdmin(hash, scopes?)` — legacy; no pubkey stored
     *   - `grantAdmin(hash, pubkey, scopes?)` — new; stores Ed25519 pubkey
     *
     * @param identityHash   - Identity to promote.
     * @param pubkeyOrScopes - Either an Ed25519 public key (base64url string),
     *                         a GatewayScope[] for the legacy call signature,
     *                         or `null` to leave any existing pubkey unchanged.
     * @param scopes         - Scopes to grant (only used when pubkeyOrScopes is
     *                         a string or null); defaults to {@link FULL_ADMIN_SCOPES}.
     *
     * @throws If the gateway has not been bootstrapped yet.
     */
    grantAdmin(
        identityHash: string,
        pubkeyOrScopes: string | null | GatewayScope[] = null,
        scopes: GatewayScope[] = FULL_ADMIN_SCOPES,
    ): void {
        // Backward compat: if second arg is an array it's the old (hash, scopes) form.
        let pubkey: string | null;
        let resolvedScopes: GatewayScope[];
        if (Array.isArray(pubkeyOrScopes)) {
            pubkey         = null;
            resolvedScopes = pubkeyOrScopes as GatewayScope[];
        } else {
            pubkey         = pubkeyOrScopes;
            resolvedScopes = scopes;
        }
        const current = this.read();
        if (!current?.owner) {
            throw new Error('Gateway has no owner. Call bootstrapOwner() first.');
        }
        const existingPubkeys = current.pubkeys ?? {};
        const nextPubkeys = pubkey
            ? { ...existingPubkeys, [identityHash]: pubkey }
            : existingPubkeys;
        const base: Omit<GatewayClaimsSnapshot, 'version' | 'updatedAt'> = {
            gatewayId: current.gatewayId,
            owner:     current.owner,
            admins:    { ...current.admins, [identityHash]: true },
            grants:    { ...current.grants, [identityHash]: resolvedScopes },
            pubkeys:   nextPubkeys,
        };
        this.write({
            ...base,
            version:   GatewayClaimsManager.computeVersion(base),
            updatedAt: Date.now(),
        });
    }

    /**
     * Removes an identity from the `admins` and `grants` maps.
     *
     * The gateway owner cannot be revoked through this method — attempting to
     * do so throws to prevent accidental lockout.
     *
     * @param identityHash - Identity to demote.
     *
     * @throws If `identityHash` is the current gateway owner.
     */
    revokeAdmin(identityHash: string): void {
        const current = this.read();
        if (!current) return;
        if (current.owner === identityHash) {
            throw new Error(
                'Cannot revoke the gateway owner. Transfer ownership first.'
            );
        }
        const admins  = { ...current.admins };
        const grants  = { ...current.grants };
        const pubkeys = { ...(current.pubkeys ?? {}) };
        delete admins[identityHash];
        delete grants[identityHash];
        delete pubkeys[identityHash];

        const base: Omit<GatewayClaimsSnapshot, 'version' | 'updatedAt'> = {
            gatewayId: current.gatewayId,
            owner:     current.owner,
            admins,
            grants,
            pubkeys,
        };
        this.write({
            ...base,
            version:   GatewayClaimsManager.computeVersion(base),
            updatedAt: Date.now(),
        });
    }

    /**
     * Transfers ownership to a different admin identity.
     *
     * The previous owner retains admin access (remains in `admins` / `grants`)
     * unless explicitly removed via {@link revokeAdmin} afterwards.
     *
     * @param newOwnerIdentityHash - Must already be present in `admins`.
     *
     * @throws If `newOwnerIdentityHash` is not a current admin.
     */
    transferOwner(newOwnerIdentityHash: string): void {
        const current = this.read();
        if (!current?.owner) {
            throw new Error('Gateway has no owner. Call bootstrapOwner() first.');
        }
        if (!current.admins[newOwnerIdentityHash]) {
            throw new Error(
                `Identity "${newOwnerIdentityHash}" is not an admin. ` +
                'Grant admin access before transferring ownership.'
            );
        }
        const base: Omit<GatewayClaimsSnapshot, 'version' | 'updatedAt'> = {
            gatewayId: current.gatewayId,
            owner:     newOwnerIdentityHash,
            admins:    current.admins,
            grants:    current.grants,
            pubkeys:   current.pubkeys ?? {},
        };
        this.write({
            ...base,
            version:   GatewayClaimsManager.computeVersion(base),
            updatedAt: Date.now(),
        });
    }
}
