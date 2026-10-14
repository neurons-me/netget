import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { getNetgetDataDir } from '../utils/netgetPaths.js';
import { isReservedLocalDomain } from '../modules/NetGetX/Domains/reservedDomains.ts';
import { checkDoorConnections, type DoorConnection } from './doorConnections.js';
import { registeredMonadPorts } from './doorConnectionPorts.js';
import { checkRouteTarget } from './routeTargets.js';
import { installationRoots, isValidDomainPattern, appNameOfTarget, type AuthorizedRoot } from './authorizedRoots.js';

export interface DomainRoute {
    type: 'proxy' | 'server' | 'static';
    target?: string;
    protocol?: 'http' | 'https';
    root?: string;
    /** Door connections (runtime/doorConnections.ts), re-checked here; surface_proxy.lua checks them again. */
    connections?: DoorConnection[];
    /** The identity the operator bound this wildcard's app to when declaring it (kernel/domainStore.ts). The router
     *  treats a wildcard `app:` route that does not carry it as unserved. */
    identity?: string;
    ssl: {
        enabled: boolean;
        cert?: string;
        key?: string;
    };
}

export interface DomainMap {
    version: number;
    generatedAt: string;
    node: { hostname: string };
    domains: Record<string, DomainRoute>;
    /**
     * The roots the router may hand names to, and the identity authorized for each (runtime/authorizedRoots.ts). A monad
     * that announces a root is not in here; absent or empty means nothing is authorized, and an address under a root
     * gets the neutral shell. An operator's wildcard route is not here: it is a domain like any other.
     */
    roots?: Record<string, AuthorizedRoot>;
}

export function getDomainMapPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'domain-map.json');
}

export function getDomainMapVersionPath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'domain-map.version');
}

// Compatibility hook kept for older activation flows.
// local.netget is now served directly by netget_app.conf, not by the public/custom routing table.
export async function ensureLocalNetgetSeed(): Promise<void> {
    return;
}

// Projects the .me kernel domain store into a minimal JSON routing table for OpenResty.
// Uses atomic write (tmp → rename) so Lua never reads a partially-written file.
// Bumps the version file after the JSON is in place — this is what triggers hot-reload.
export async function generateDomainMap(): Promise<string> {
    const { getDomains } = await import('../kernel/domainStore.js');
    const rows = await getDomains();
    const domains: Record<string, DomainRoute> = {};

    for (const row of rows) {
        if (!row.domain) continue;

        const key = row.domain.toLowerCase();
        if (isReservedLocalDomain(key)) continue;
        if (!row.type) continue;
        // `*` is valid only as `*.<name>`: anything else is not a route (a pattern the router could read two ways).
        if (!isValidDomainPattern(key)) {
            console.warn(`[domain-map] ${key}: not projected (a wildcard is only valid as *.<name>)`);
            continue;
        }

        const type: DomainRoute['type'] =
            row.type === 'static' ? 'static'
            : row.type === 'server' ? 'server'
            : 'proxy';

        const ssl: DomainRoute['ssl'] =
            (row.sslCertificate && row.sslCertificateKey)
                ? { enabled: true, cert: row.sslCertificate, key: row.sslCertificateKey }
                : { enabled: false };

        const route: DomainRoute = { type, ssl };

        // The projection is the last gate before the router: what the store refuses on the way in is refused here too
        // (a record edited by hand, written by an older version). A route that fails is not projected, so the router
        // never sees a destination the gateway itself would not have accepted.
        {
            const registeredPorts = registeredMonadPorts();
            const wanted = type === 'static' ? row.target : row.target ?? '';
            const checked = checkRouteTarget(type, wanted, { registeredPorts });
            if (checked.ok === false && !(row.type === 'main_server')) {
                console.warn(`[domain-map] ${key}: not projected (${checked.code}: ${checked.reason})`);
                continue;
            }
        }

        if (type === 'static') {
            if (!row.target) continue;
            route.root = row.target ?? undefined;
        } else if (type === 'server') {
            if (!row.target) continue;
            route.target = row.target ?? undefined;
            route.protocol = 'http';
        } else {
            if (row.target) route.target = row.target;
            route.protocol = 'http';
        }

        // A static folder has nothing to carve out of; a dynamic route may carry connections. A list that fails any
        // rule is not projected at all (a partial list would silently change which path goes where).
        if (type !== 'static' && Array.isArray(row.connections) && row.connections.length > 0) {
            const checked = checkDoorConnections(row.connections, registeredMonadPorts());
            if (checked.ok) route.connections = checked.connections;
        }

        // A wildcard route to an app is served only from the identity it was bound to at declaration. A record with no
        // identity (written by hand, or by a version that did not bind) is projected as such and the router refuses it,
        // never serving "whoever is registered under that name".
        if (key.startsWith('*.') && row.identity && appNameOfTarget(row.target)) route.identity = row.identity;

        domains[key] = route;
    }

    const map: DomainMap = {
        version: 1,
        generatedAt: new Date().toISOString(),
        node: { hostname: os.hostname() },
        domains,
        roots: await installationRoots(),
    };

    const outPath = getDomainMapPath();
    const tmpPath = outPath + '.tmp';
    const runtimeDir = path.dirname(outPath);
    fs.mkdirSync(runtimeDir, { recursive: true });

    const content = JSON.stringify(map, null, 2);
    try {
        // Atomic write: JSON is fully in place before version file is bumped.
        fs.writeFileSync(tmpPath, content, 'utf8');
    } catch (error: any) {
        if (error?.code !== 'EACCES') throw error;
        // The runtime dir may be owned by another user (e.g. www-data, from
        // the OpenResty worker writing apps.json there first). Self-heal by
        // reclaiming ownership for the current user, then retry once.
        reclaimRuntimeDirOwnership(runtimeDir);
        fs.writeFileSync(tmpPath, content, 'utf8');
    }
    fs.renameSync(tmpPath, outPath);

    // Version bump signals Lua workers to hot-reload.
    fs.writeFileSync(getDomainMapVersionPath(), String(Date.now()), 'utf8');

    return outPath;
}

// Make the runtime dir shareable between the CLI user and the OpenResty
// worker user (e.g. www-data), which may have created it first while writing
// apps.json on a fresh install. Rather than transferring ownership (which
// could lock www-data out of apps.json), put the dir in the current user's
// group, make it group-writable, and set the setgid bit so new files
// (apps.json, domain-map.json, etc.) inherit that group regardless of which
// process creates them. Best-effort: requires passwordless-capable sudo
// (the same install/repair flow already needs sudo for OpenResty itself).
function reclaimRuntimeDirOwnership(runtimeDir: string): void {
    const gid = process.getgid?.();
    if (gid == null) return;
    spawnSync('sudo', ['chgrp', '-R', String(gid), runtimeDir], { stdio: 'ignore' });
    spawnSync('sudo', ['chmod', '-R', 'g+rwX', runtimeDir], { stdio: 'ignore' });
    spawnSync('sudo', ['chmod', 'g+s', runtimeDir], { stdio: 'ignore' });
}

// Signals OpenResty (or nginx) to gracefully reload workers.
// Only needed when nginx.conf itself changes (e.g. first gateway activation).
// Subsequent domain-map changes are picked up automatically by the Lua timer.
export function reloadNginx(): void {
    for (const bin of ['openresty', 'nginx']) {
        const r = spawnSync(bin, ['-s', 'reload'], { encoding: 'utf8' });
        if (!r.error && r.status === 0) return;
    }
}
