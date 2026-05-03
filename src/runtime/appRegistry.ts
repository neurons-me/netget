import fs from 'fs';
import path from 'path';
import { getNetgetDataDir } from '../utils/netgetPaths.js';
import type { NetGetAppRegistration } from '../netget.js';

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
