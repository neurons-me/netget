import fs from 'fs';
import path from 'path';
import { getNetgetDataDir, getNetgetPackageRootDir } from '../../../utils/netgetPaths.js';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.ts';
import type { XConfig } from '../config/xConfig.ts';

export type MainServerFrontendMode = 'dev' | 'package-dist' | 'local-dist';

export interface MainServerFrontendConfig {
    mode: MainServerFrontendMode;
    devUrl: string;
    staticRoot: string;
    packageDistRoot: string;
    localDistRoot: string;
}

const DEFAULT_DEV_URL = 'http://127.0.0.1:5173';

export function getPackageMainServerUiDistDir(): string {
    return path.join(getNetgetPackageRootDir(), 'assets', 'main-server-ui', 'dist');
}

export function getLocalMainServerUiDistDir(): string {
    return path.join(getNetgetDataDir(), 'dist');
}

function readXConfigSync(): XConfig {
    const configPath = path.join(getNetgetDataDir(), 'xConfig.json');
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8')) as XConfig;
    } catch {
        return {};
    }
}

function normalizeMode(value: unknown): MainServerFrontendMode {
    if (value === 'dev' || value === 'package-dist' || value === 'local-dist') return value;
    return 'package-dist';
}

function normalizeDevUrl(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_DEV_URL;
    return raw.replace(/\/+$/, '');
}

export function resolveMainServerFrontendConfig(config: Partial<XConfig> = readXConfigSync()): MainServerFrontendConfig {
    const mode = normalizeMode(config.mainServerFrontendMode);
    const packageDistRoot = getPackageMainServerUiDistDir();
    const localDistRoot = getLocalMainServerUiDistDir();
    const staticRoot = String(config.mainServerFrontendStaticRoot || '').trim();

    return {
        mode,
        devUrl: normalizeDevUrl(config.mainServerFrontendDevUrl),
        staticRoot: staticRoot || packageDistRoot,
        packageDistRoot,
        localDistRoot,
    };
}

export async function saveMainServerFrontendConfig(updates: {
    mode?: MainServerFrontendMode;
    devUrl?: string;
    staticRoot?: string;
}): Promise<MainServerFrontendConfig> {
    const current = await loadOrCreateXConfig();
    const nextMode = updates.mode || normalizeMode(current.mainServerFrontendMode);
    const nextDevUrl = normalizeDevUrl(updates.devUrl ?? current.mainServerFrontendDevUrl);
    const nextStaticRoot = String(updates.staticRoot ?? current.mainServerFrontendStaticRoot ?? '').trim();

    await saveXConfig({
        mainServerFrontendMode: nextMode,
        mainServerFrontendDevUrl: nextDevUrl,
        mainServerFrontendStaticRoot: nextStaticRoot,
    });

    return resolveMainServerFrontendConfig({
        ...current,
        mainServerFrontendMode: nextMode,
        mainServerFrontendDevUrl: nextDevUrl,
        mainServerFrontendStaticRoot: nextStaticRoot,
    });
}

export function getActiveStaticRoot(frontend = resolveMainServerFrontendConfig()): string {
    if (frontend.mode === 'local-dist') return frontend.localDistRoot;
    if (frontend.mode === 'package-dist') return frontend.staticRoot || frontend.packageDistRoot;
    return frontend.staticRoot || frontend.packageDistRoot;
}

export function hasIndexHtml(root: string): boolean {
    return fs.existsSync(path.join(root, 'index.html'));
}

export function copyPackageMainServerUiToLocalDist(): { copied: boolean; from: string; to: string } {
    const from = getPackageMainServerUiDistDir();
    const to = getLocalMainServerUiDistDir();

    if (!fs.existsSync(from)) {
        throw new Error(`Bundled Main Server UI dist not found: ${from}`);
    }

    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true });
    return { copied: true, from, to };
}

export interface SyncHtmlRootResult {
    copied: boolean;
    to: string;
    from?: string;
    reason?: string;
}

/**
 * Mirrors the active Main Server UI build into `${xConfig}/html` — the
 * directory nginx.conf's plain-HTTP `location /` Lua handler serves
 * `index.html` from directly (see setNginxConfigFile.ts) for
 * local.netget/localhost/127.0.0.1 and as the last-resort fallback once a
 * public main domain is set. Without this, that path is a 404: nothing else
 * writes an index.html there, so netget's own entry point depends entirely
 * on whichever domain-map route happens to also be registered for those
 * hosts. This makes it a real, netget-owned index independent of that.
 *
 * No-op in `dev` mode: there's nothing to copy, the panel is proxied live
 * from the Vite dev server instead.
 */
export function syncMainServerFrontendToHtmlRoot(): SyncHtmlRootResult {
    const to = path.join(getNetgetDataDir(), 'html');
    const frontend = resolveMainServerFrontendConfig();

    if (frontend.mode === 'dev') {
        return { copied: false, to, reason: `dev mode proxies to ${frontend.devUrl} — nothing to copy` };
    }

    const from = getActiveStaticRoot(frontend);
    if (!hasIndexHtml(from)) {
        return { copied: false, to, from, reason: `no built index.html found at ${from}` };
    }

    const destIndex = path.join(to, 'index.html');
    const srcIndex = path.join(from, 'index.html');
    if (fs.existsSync(destIndex)) {
        const srcStat = fs.statSync(srcIndex);
        const destStat = fs.statSync(destIndex);
        if (srcStat.mtimeMs <= destStat.mtimeMs && srcStat.size === destStat.size) {
            return { copied: false, to, from, reason: 'already up to date' };
        }
    }

    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true });
    return { copied: true, to, from };
}
