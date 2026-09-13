/**
 * openRestyInstallJob.ts
 *
 * The ONE unattended-install action this codebase can safely offer from an
 * HTTP-originated request today: `brew install openresty/brew/openresty`
 * on macOS, when canInstallOpenRestyViaHomebrew() (openRestyService.ts)
 * already confirmed Homebrew is present and writable by this process's
 * user — no sudo, no password prompt, nothing this backend could hang on.
 * Starting OpenResty (as a service or ad hoc) is NOT here — both paths in
 * openRestyService.ts call runSudoShell() because binding :80/:443 needs
 * root regardless of platform, and there is no privileged-helper
 * infrastructure in this codebase to do that safely from HTTP. That stays
 * a terminal step; see GatewaySetup.tsx's rendering of `remediation`.
 *
 * Runs via spawn(), not execSync/exec — a multi-minute Homebrew build
 * (real, when no bottle exists for this macOS version) must never block
 * the Express event loop, and the whole point of a job is to report
 * incremental progress, which a blocking call can't do anyway.
 *
 * State is a single module-level singleton, not one job per caller: this
 * mirrors GatewaySetup.tsx's own "one setup process" model (setup-session
 * is already single-flight — see gatewaySetupSession.ts's own header
 * comment) and is what makes "avoid concurrent installs" and "reconnect
 * to see the same job after a reload" the same mechanism instead of two.
 * Lives only in memory: a backend restart mid-install loses the job, same
 * as any other in-flight request would — there is nothing to persist that
 * would still be meaningful after the process (and the child it spawned)
 * is gone.
 */

import { spawn } from 'child_process';
import { canInstallOpenRestyViaHomebrew } from './openRestyService.js';

export type InstallJobStatus = 'running' | 'success' | 'error';

export interface InstallJobSnapshot {
  id: string;
  status: InstallJobStatus;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
  message: string | null;
}

const MAX_LOG_LINES = 500;

let currentJob: InstallJobSnapshot | null = null;

function appendLog(job: InstallJobSnapshot, chunk: string): void {
  const lines = chunk.split(/\r?\n/).filter((l) => l.length > 0);
  job.log.push(...lines);
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
}

export function getInstallJobSnapshot(): InstallJobSnapshot | null {
  return currentJob ? { ...currentJob, log: [...currentJob.log] } : null;
}

export interface StartInstallJobResult {
  ok: boolean;
  job: InstallJobSnapshot | null;
  message?: string;
}

/**
 * Idempotent: a second call while a job is already `running` returns that
 * SAME job instead of spawning a second `brew install` — this is the
 * "avoid concurrent installs" guarantee, not a separate lock. A caller
 * that reloads the page and calls this again mid-install just gets handed
 * the job already in flight.
 */
export function startInstallJob(): StartInstallJobResult {
  if (currentJob && currentJob.status === 'running') {
    return { ok: true, job: getInstallJobSnapshot() };
  }

  const availability = canInstallOpenRestyViaHomebrew();
  if (!availability.available) {
    return { ok: false, job: null, message: availability.reason };
  }

  const job: InstallJobSnapshot = {
    id: `install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
    message: null,
  };
  currentJob = job;

  const child = spawn('brew', ['install', 'openresty/brew/openresty'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => appendLog(job, chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => appendLog(job, chunk.toString('utf8')));

  child.on('error', (err) => {
    job.status = 'error';
    job.finishedAt = Date.now();
    job.message = err instanceof Error ? err.message : String(err);
  });

  child.on('exit', (code) => {
    // 'error' above already finalized the job (e.g. brew not found at
    // spawn time despite the pre-check) — don't overwrite that outcome.
    if (job.status !== 'running') return;
    job.finishedAt = Date.now();
    if (code === 0) {
      job.status = 'success';
      job.message = 'OpenResty installed via Homebrew.';
    } else {
      job.status = 'error';
      job.message = `brew install exited with code ${code}.`;
    }
  });

  return { ok: true, job: getInstallJobSnapshot() };
}
