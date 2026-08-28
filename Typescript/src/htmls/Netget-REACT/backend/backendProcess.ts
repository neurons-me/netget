/**
 * backendProcess.ts
 *
 * Supervises local.netget's own Express backend (proxy.js) as a plain
 * detached child process — replaces PM2 (`ecosystem.config.cjs`). Same
 * PID-file pattern already used successfully twice in this codebase
 * (modules/NetGetX/OpenResty/devServer.ts, kernel's netget monad spawn
 * before it was delegated to monad.ai's own runtime API) rather than a
 * separate daemon: no extra dependency to have installed/running, and it's
 * now the one consistent way netget supervises its own child processes.
 *
 * PM2 gave crash-restart and log rotation for free; this trades that for
 * consistency and zero extra moving parts. If crash-restart is ever
 * actually needed, that's a small addition on top (a watchdog loop), not a
 * reason to bring back a separate process manager.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BackendProcessStatus {
  ok: boolean;
  running: boolean;
  pid?: number;
  port: number;
  url: string;
  message: string;
}

function getPidFilePath(): string {
  return path.join(getNetgetDataDir(), 'runtime', 'backend.pid');
}

function getLogFilePath(): string {
  return path.join(getNetgetDataDir(), 'runtime', 'backend.log');
}

function getBackendPort(): number {
  const explicit = Number(process.env.PORT);
  return Number.isInteger(explicit) && explicit > 0 ? explicit : 3000;
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

export async function getBackendStatus(): Promise<BackendProcessStatus> {
  const port = getBackendPort();
  const url = `http://127.0.0.1:${port}/healthcheck`;
  const pid = readPid();

  if (await isUrlResponding(url)) {
    return { ok: true, running: true, pid: pid ?? undefined, port, url, message: `local.netget backend responding on port ${port}.` };
  }
  if (pid && isProcessAlive(pid)) {
    return { ok: true, running: false, pid, port, url, message: `Process ${pid} is alive but port ${port} isn't responding yet — it may still be starting.` };
  }
  return { ok: true, running: false, port, url, message: 'local.netget backend is not running.' };
}

export interface StartBackendOptions {
  production?: boolean;
}

export async function startBackend(options: StartBackendOptions = {}): Promise<BackendProcessStatus> {
  const existing = await getBackendStatus();
  if (existing.running) return existing;

  const port = getBackendPort();
  const proxyPath = path.join(__dirname, 'proxy.js');
  if (!fs.existsSync(proxyPath)) {
    return { ok: false, running: false, port, url: `http://127.0.0.1:${port}`, message: `proxy.js not found at ${proxyPath}.` };
  }

  const stalePid = readPid();
  if (stalePid && !isProcessAlive(stalePid)) {
    fs.rmSync(getPidFilePath(), { force: true });
  }

  const logPath = getLogFilePath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');

  const npxSibling = path.join(path.dirname(process.execPath), 'npx');
  const npxBin = fs.existsSync(npxSibling) ? npxSibling : 'npx';

  const env = {
    ...process.env,
    NODE_ENV: options.production ? 'production' : 'development',
    PORT: String(port),
    USE_HTTPS: options.production ? 'true' : 'false',
  };

  let child;
  try {
    // Mirrors ecosystem.config.cjs's interpreter setting — proxy.js is
    // plain JS but its routes import domainStore.ts (.ts) directly.
    child = spawn(npxBin, ['tsx', 'proxy.js'], {
      cwd: __dirname,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    fs.closeSync(logFd);
  }
  child.unref();

  if (!child.pid) {
    return { ok: false, running: false, port, url: `http://127.0.0.1:${port}`, message: 'Failed to spawn the local.netget backend process.' };
  }

  fs.writeFileSync(getPidFilePath(), String(child.pid), 'utf8');
  return {
    ok: true,
    running: false,
    pid: child.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    message: `local.netget backend starting (pid ${child.pid}). It can take a few seconds to become ready — log: ${logPath}`,
  };
}

export async function stopBackend(): Promise<{ ok: boolean; message: string }> {
  const pid = readPid();
  if (!pid) return { ok: true, message: 'local.netget backend is not running.' };

  if (isProcessAlive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
  fs.rmSync(getPidFilePath(), { force: true });
  return { ok: true, message: `local.netget backend (pid ${pid}) stopped.` };
}
