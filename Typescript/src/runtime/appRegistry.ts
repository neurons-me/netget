import fs from 'fs';
import path from 'path';
import { getNetgetDataDir } from '../utils/netgetPaths.js';
import type { NetGetAppRegistration } from '../netget.js';
import { GatewayClaimsManager } from '../modules/NetGetX/Auth/GatewayClaimsManager.js';

interface AppRegistryFile {
    version?: number;
    updatedAt?: string;
    apps?: Record<string, NetGetAppRegistration & { lastSeenMs?: number }>;
}

export function getAppRegistryPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'apps.json');
}

export function readReportedApps(): Array<NetGetAppRegistration & { lastSeenMs?: number; alive: boolean }> {
    const registryPath = getAppRegistryPath();
    let registry: AppRegistryFile;

    try {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as AppRegistryFile;
    } catch {
        return [];
    }

    const now = Date.now();
    return Object.values(registry.apps || {})
        .map((app) => {
            const lastSeenMs = Number(app.lastSeenMs || 0);
            const ttlMs = Number(app.ttlMs || 45_000);
            return { ...app, lastSeenMs, alive: lastSeenMs > 0 && now - lastSeenMs <= ttlMs };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

export type UpsertReportedAppResult =
    | { ok: true; id: string }
    | { ok: false; error: string };

/**
 * The write half of the mesh registry — apps.lua's own report_app() action
 * (modules/netget/Typescript/src/modules/NetGetX/OpenResty/lua/handlers/
 * apps.lua), ported here because it only exists in Lua today: every real
 * production deployment runs it behind OpenResty, but nothing in this
 * codebase's own Express-based dev harnesses (which run no nginx/Lua at
 * all) can receive a real monad's POST /apps/report heartbeat. This is
 * NOT a simplified stand-in — it reproduces apps.lua's own contract field
 * for field:
 *   - id/name required, else rejected (400).
 *   - lastSeenMs and localOnly are ALWAYS server-stamped here, never
 *     trusted from the reporting payload — a monad claiming a fake
 *     heartbeat time or claiming non-local status could otherwise forge
 *     liveness or bypass the loopback boundary this exists to enforce.
 *   - trust (owner/admin/peer/guest) is derived HERE, from the real
 *     gateway-claims snapshot (GatewayClaimsManager), never from whatever
 *     the reporting payload's own metadata.identity_hash claims to be —
 *     the same "vigencia/autorización" split this session's other work
 *     already established elsewhere: a self-reported identity hash proves
 *     nothing about what it's entitled to without an independent check.
 *   - expired entries are scrubbed before merging, on every report, not
 *     just at read time.
 *   - frontendMode is an operator preference the reporting app never
 *     sends — preserved across re-registration instead of being wiped by
 *     the next heartbeat.
 *   - the write is atomic (tmp + rename), matching every other durable
 *     write in this codebase and apps.lua's own tmp-file convention for
 *     this exact file.
 *
 * Callers are responsible for the loopback/transport check (apps.lua's
 * own is_local_request(), checked against ngx.var.remote_addr — the real
 * peer address, never a spoofable header) before ever calling this; it is
 * an HTTP-layer concern, not a registry-mutation one, so it isn't
 * duplicated here — see localNetget.js's own POST /apps/report route for
 * where that check actually lives.
 */
export function upsertReportedApp(payload: unknown): UpsertReportedAppResult {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'Invalid JSON body.' };
    }
    const app = { ...(payload as Record<string, unknown>) };
    const id = String(app.id || '').trim();
    const name = String(app.name || '').trim();
    if (!id || !name) {
        return { ok: false, error: 'App id and name are required.' };
    }

    const registryPath = getAppRegistryPath();
    let registry: AppRegistryFile;
    try {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as AppRegistryFile;
        if (!registry || typeof registry !== 'object') registry = { version: 1, apps: {} };
    } catch {
        registry = { version: 1, apps: {} };
    }
    registry.apps = registry.apps || {};

    // Scrub expired entries before merging — apps.lua's report_app() does
    // this on every report, not only at list time.
    const now = Date.now();
    for (const [existingId, existingApp] of Object.entries(registry.apps)) {
        const ttlMs = Number((existingApp as { ttlMs?: number }).ttlMs || 45_000);
        const lastSeenMs = Number((existingApp as { lastSeenMs?: number }).lastSeenMs || 0);
        if (now - lastSeenMs > ttlMs) delete registry.apps[existingId];
    }

    app.lastSeenMs = now;
    app.localOnly = true;

    const meta = (app.metadata && typeof app.metadata === 'object') ? app.metadata as Record<string, unknown> : {};
    const identityHash = String(meta.identity_hash || meta.identityHash || '').trim();
    const claims = new GatewayClaimsManager();
    app.trust = !identityHash
        ? 'guest'
        : claims.isOwner(identityHash)
            ? 'owner'
            : claims.isAdmin(identityHash)
                ? 'admin'
                : 'peer';
    if (app.trust !== 'guest') app.verified_at = now;

    const existing = registry.apps[id] as (Record<string, unknown> | undefined);
    if (existing?.frontendMode && !app.frontendMode) {
        app.frontendMode = existing.frontendMode;
    }

    registry.apps[id] = app as unknown as NetGetAppRegistration & { lastSeenMs?: number };
    registry.version = (registry.version || 0) + 1;
    registry.updatedAt = new Date().toISOString();

    const dir = path.dirname(registryPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${registryPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmpPath, registryPath);

    return { ok: true, id };
}
