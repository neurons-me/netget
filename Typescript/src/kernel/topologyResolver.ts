/**
 * topologyResolver.ts — netget's implementation of cleaker's own
 * `TopologyResolver` interface (modules/cleaker/Typescript/src/topology/
 * resolver.ts): "Cleaker owns contextual meaning: name + space = namespace.
 * A resolver owns reachability: namespace/surface -> endpoint. NetGet is
 * expected to implement this interface."
 *
 * This is a TypeScript port of `lua/handlers/surface_proxy.lua`'s own
 * reduction algorithm (rootspace extraction -> collect live candidates from
 * apps.json -> reduce by trust tier, then recency) — NOT a new resolution
 * mechanism. surface_proxy.lua answers "which monad should handle this
 * inbound HTTP request" at request time; resolve() below answers the same
 * underlying question ("which live surface currently claims this
 * namespace?") as a plain callable/addressable function, for cleaker (or
 * anything else) to ask directly instead of only being able to infer it by
 * making an HTTP request and seeing where it lands. Keep the two in sync —
 * if surface_proxy.lua's algorithm changes, mirror the change here.
 *
 * register() is intentionally left unimplemented: monad instances already
 * self-register into apps.json via the existing `/apps/report` heartbeat
 * (see modules/monad/Typescript/src/runtime/netgetRegistration.ts) — there
 * is nothing for a second registration path to do yet.
 */
import type { TopologyResolver, ResolveSurfaceInput, SurfaceEndpoint } from 'cleaker';
import { readReportedApps } from '../runtime/appRegistry.js';

const TRUST_RANK: Record<string, number> = { owner: 4, admin: 3, peer: 2, guest: 1 };

function normalizeHost(value: unknown): string {
    let raw = String(value ?? '').toLowerCase();
    raw = raw.replace(/^https?:\/\//, '');
    raw = raw.replace(/^\[/, '').replace(/\]$/, '');
    const match = raw.match(/^([^:/]+)/);
    return match ? match[1] : raw;
}

function tableHasHost(values: unknown, target: string): boolean {
    if (!values || typeof values !== 'object') return false;
    return Object.values(values as Record<string, unknown>).some((v) => normalizeHost(v) === target);
}

// Mirrors surface_proxy.lua's app_claims_host() exactly — same field list,
// same order.
function appClaimsHost(app: { tags?: string[] }, meta: Record<string, unknown>, target: string): boolean {
    if (!target) return false;
    if (normalizeHost(meta.namespace) === target) return true;
    if (normalizeHost(meta.identity) === target) return true;
    if (normalizeHost(meta.host) === target) return true;
    if (normalizeHost(meta.hostname) === target) return true;
    if (normalizeHost(meta.publicHost) === target) return true;
    if (normalizeHost(meta.public_host) === target) return true;
    if (normalizeHost(meta.domain) === target) return true;
    if (tableHasHost(meta.aliases, target)) return true;
    if (tableHasHost(meta.hosts, target)) return true;
    if (tableHasHost(meta.domains, target)) return true;
    if (tableHasHost(meta.claimedNamespaces, target)) return true;
    if (tableHasHost(meta.claimed_namespaces, target)) return true;
    if (tableHasHost(app.tags, target)) return true;
    return false;
}

// Mirrors surface_proxy.lua's rootspace_of() — strips a single leading
// handle label off a 3+-label namespace. "jabellae.suis-macbook-air.local"
// -> "suis-macbook-air.local"; "suis-macbook-air.local" stays as-is.
export function rootspaceOf(namespace: string): string {
    const labels = namespace.split('.').filter(Boolean);
    if (labels.length >= 3) {
        return labels.slice(1).join('.');
    }
    return namespace;
}

interface Candidate {
    endpoint: string;
    lastSeen: number;
    trust: string;
    identityHash: string;
    surface: string;
    namespace: string;
}

/** The actual resolve() implementation, usable directly (not just through
 * the HTTP route) — e.g. for tests, or for a future in-process caller. */
export async function resolveSurface(input: ResolveSurfaceInput): Promise<SurfaceEndpoint | null> {
    const namespace = String(input?.namespace || '').trim().toLowerCase();
    if (!namespace) return null;

    const rootspace = rootspaceOf(namespace);
    const apps = readReportedApps();

    const candidates: Candidate[] = [];
    for (const app of apps) {
        if (!app.alive) continue;
        const meta = (app.metadata || {}) as Record<string, unknown>;
        const endpoint = String(meta.directEndpoint || meta.endpoint || meta.controlEndpoint || app.url || '').trim();
        if (!endpoint) continue;

        if (appClaimsHost(app, meta, rootspace) || appClaimsHost(app, meta, namespace)) {
            candidates.push({
                endpoint,
                lastSeen: Number(app.lastSeenMs || 0),
                // apps.json's `trust` field is materialized by apps.lua's
                // report_app()/derive_trust() at ingest time (checked
                // against gateway-claims.json) — not present on
                // NetGetAppRegistration's TS type, read defensively.
                trust: String((app as unknown as { trust?: string }).trust || 'guest'),
                identityHash: String(meta.identity_hash || meta.identityHash || ''),
                surface: app.name,
                namespace: String(meta.namespace || ''),
            });
        }
    }

    if (candidates.length === 0) return null;

    // selector, if given, explicitly picks a named surface instead of
    // running the trust/recency reduction — e.g. "surface:netget".
    const selector = String(input?.selector || '').trim();
    if (selector) {
        const wanted = selector.replace(/^surface:/, '');
        const picked = candidates.find((c) => c.surface === wanted);
        if (picked) return toSurfaceEndpoint(picked);
    }

    // Same reduction as surface_proxy.lua: highest trust tier wins;
    // most-recently-seen breaks ties within the same tier.
    let best = candidates[0];
    let bestRank = TRUST_RANK[best.trust] ?? TRUST_RANK.guest;
    for (const c of candidates.slice(1)) {
        const rank = TRUST_RANK[c.trust] ?? TRUST_RANK.guest;
        if (rank > bestRank || (rank === bestRank && c.lastSeen > best.lastSeen)) {
            best = c;
            bestRank = rank;
        }
    }

    return toSurfaceEndpoint(best);
}

function toSurfaceEndpoint(c: Candidate): SurfaceEndpoint {
    return {
        url: c.endpoint.replace(/\/+$/, ''),
        transport: c.endpoint.startsWith('https:') ? 'https' : 'http',
        surface: c.surface,
        lastSeen: c.lastSeen || undefined,
        metadata: { identityHash: c.identityHash || undefined, namespace: c.namespace || undefined, trust: c.trust },
    };
}

export const netgetTopologyResolver: TopologyResolver = {
    resolve: resolveSurface,
    // register intentionally omitted — see file header.
};
