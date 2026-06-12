import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { getNetgetDataDir } from '../utils/netgetPaths.js';
import { isReservedLocalDomain } from '../modules/NetGetX/Domains/reservedDomains.ts';

export interface DomainRoute {
    type: 'proxy' | 'server' | 'static';
    target?: string;
    protocol?: 'http' | 'https';
    root?: string;
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
        if (!row.type || !row.target) continue;

        const type: DomainRoute['type'] =
            row.type === 'static' ? 'static'
            : row.type === 'server' ? 'server'
            : 'proxy';

        const ssl: DomainRoute['ssl'] =
            (row.sslCertificate && row.sslCertificateKey)
                ? { enabled: true, cert: row.sslCertificate, key: row.sslCertificateKey }
                : { enabled: false };

        const route: DomainRoute = { type, ssl };

        if (type === 'static') {
            route.root = row.target ?? undefined;
        } else {
            route.target = row.target ?? undefined;
            route.protocol = 'http';
        }

        domains[key] = route;
    }

    const map: DomainMap = {
        version: 1,
        generatedAt: new Date().toISOString(),
        node: { hostname: os.hostname() },
        domains,
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

// Reclaim ownership of the runtime dir for the current user. The directory
// can end up owned by the OpenResty worker user (e.g. www-data) because it
// writes apps.json there first, on a fresh install, before the CLI ever
// writes domain-map.json. Best-effort: requires passwordless-capable sudo
// (the same install/repair flow already needs sudo for OpenResty itself).
function reclaimRuntimeDirOwnership(runtimeDir: string): void {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid == null || gid == null) return;
    spawnSync('sudo', ['chown', '-R', `${uid}:${gid}`, runtimeDir], { stdio: 'ignore' });
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
