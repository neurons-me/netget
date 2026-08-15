// devServer.ts
// Lifecycle control for the local GUI package's Vite dev server — the
// process netget's "dev" main-server-frontend mode proxies to (see
// mainServerFrontend.ts / setNginxConfigRoutes.ts's rootLocation/
// netgetPanelErrorLocation). Exists so the GatewayStatus.html "start dev
// server" button (State 4, netget panel case only) has something real to
// call instead of just telling the operator to go run `npm run dev` by hand.
//
// Process supervision is the one thing this session spent hours fighting
// with openresty itself (orphaned masters, no single owner, un-killable
// without sudo) — this deliberately avoids repeating that: one PID file,
// spawned as its own detached process group, killed as a whole group so
// Vite's own child processes don't get left behind either.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getNetgetDataDir, getNetgetPackageRootDir } from '../../../utils/netgetPaths.js';
import { resolveMainServerFrontendConfig } from './mainServerFrontend.ts';

export interface DevServerStatus {
    ok: boolean;
    running: boolean;
    pid?: number;
    url: string;
    message: string;
}

function getPidFilePath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'dev-server.pid');
}

function getLogFilePath(): string {
    return path.join(getNetgetDataDir(), 'runtime', 'dev-server.log');
}

/**
 * The GUI package this feature starts. Only resolvable from within the
 * all.this monorepo (netget lives at all.this/modules/netget/Typescript,
 * the GUI package at all.this/packages/GUI/Typescript) — "dev" frontend
 * mode is a monorepo-development feature by nature, not something a
 * standalone netget install needs.
 */
export function getGuiDevDir(): string {
    return path.resolve(getNetgetPackageRootDir(), '..', '..', '..', 'packages', 'GUI', 'Typescript');
}

function readPid(): number | null {
    try {
        const raw = fs.readFileSync(getPidFilePath(), 'utf8').trim();
        const pid = Number(raw);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        // Signal 0: existence check only, sends nothing.
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function isUrlResponding(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        return res.status < 500;
    } catch {
        return false;
    }
}

export async function getDevServerStatus(): Promise<DevServerStatus> {
    const { devUrl } = resolveMainServerFrontendConfig();
    const pid = readPid();

    if (await isUrlResponding(devUrl)) {
        return { ok: true, running: true, pid: pid ?? undefined, url: devUrl, message: `Dev server responding at ${devUrl}.` };
    }
    if (pid && isProcessAlive(pid)) {
        return { ok: true, running: false, pid, url: devUrl, message: `Process ${pid} is alive but ${devUrl} isn't responding yet — it may still be starting.` };
    }
    return { ok: true, running: false, url: devUrl, message: 'Dev server is not running.' };
}

export async function startDevServer(): Promise<DevServerStatus> {
    const existing = await getDevServerStatus();
    if (existing.running) return existing;

    const { devUrl } = resolveMainServerFrontendConfig();
    const guiDir = getGuiDevDir();
    if (!fs.existsSync(path.join(guiDir, 'package.json'))) {
        return { ok: false, running: false, url: devUrl, message: `GUI package not found at ${guiDir} — the dev server can only be started from within the netget monorepo.` };
    }

    // Clean up a stale PID file left by a process that's since died.
    const stalePid = readPid();
    if (stalePid && !isProcessAlive(stalePid)) {
        fs.rmSync(getPidFilePath(), { force: true });
    }

    const logPath = getLogFilePath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, 'a');

    // Resolve npm as a sibling of the currently-running node binary rather
    // than trusting PATH — this whole feature is reached from a launchd
    // worker with a stripped PATH (see openresty.lua's resolve_netget_bin
    // comment for the same problem), and npm sits next to node in both nvm
    // and Homebrew installs.
    const npmSibling = path.join(path.dirname(process.execPath), 'npm');
    const npmBin = fs.existsSync(npmSibling) ? npmSibling : 'npm';

    let child;
    try {
        child = spawn(npmBin, ['run', 'dev'], {
            cwd: guiDir,
            detached: true,
            stdio: ['ignore', logFd, logFd],
        });
    } finally {
        fs.closeSync(logFd);
    }
    child.unref();

    if (!child.pid) {
        return { ok: false, running: false, url: devUrl, message: 'Failed to spawn the dev server process.' };
    }

    fs.writeFileSync(getPidFilePath(), String(child.pid), 'utf8');
    return {
        ok: true,
        running: false,
        pid: child.pid,
        url: devUrl,
        message: `Dev server starting (pid ${child.pid}). It can take a few seconds to become ready — log: ${logPath}`,
    };
}

export async function stopDevServer(): Promise<{ ok: boolean; message: string }> {
    const pid = readPid();
    if (!pid) return { ok: true, message: 'Dev server is not running.' };

    if (isProcessAlive(pid)) {
        try {
            // Negative pid = signal the whole process group. spawn's
            // detached:true makes the child its own group leader, so this
            // takes Vite's own child processes (esbuild, etc.) down with
            // it instead of leaving them behind as orphans.
            process.kill(-pid, 'SIGTERM');
        } catch {
            try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
        }
    }
    fs.rmSync(getPidFilePath(), { force: true });
    return { ok: true, message: `Dev server (pid ${pid}) stopped.` };
}
