// processHygiene.ts -- find, stop and verify the processes a test started, by what they ARE (their environment names the
// monad) and not by a record that a race can overwrite.
import { execFileSync } from 'node:child_process';

/** Pids of processes whose environment has KEY=VALUE (or KEY=<startsWith> with `prefix`). Own processes only. */
export function pidsWithEnv(key: string, value: string, { prefix = false }: { prefix?: boolean } = {}): number[] {
  let out = '';
  // BSD-style `eww -ax` (the `-axeww` spelling silently omits the environment of some processes on macOS)
  try { out = execFileSync('ps', ['eww', '-ax', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return []; }
  const needle = `${key}=${value}`;
  const pids: number[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    const env = m[2];
    const hit = prefix ? env.includes(` ${needle}`) : (env.includes(` ${needle} `) || env.endsWith(` ${needle}`));
    if (hit) pids.push(pid);
  }
  return pids;
}

export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** SIGTERM, then SIGKILL after `graceMs`; resolves with the pids that are STILL alive (empty = all gone). */
export async function killAll(pids: number[], graceMs = 3000): Promise<number[]> {
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && pids.some(alive)) await new Promise((r) => setTimeout(r, 100));
  for (const pid of pids.filter(alive)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  const end = Date.now() + 2000;
  while (Date.now() < end && pids.some(alive)) await new Promise((r) => setTimeout(r, 50));
  return pids.filter(alive);
}

/** TCP ports in LISTEN state owned by `pids`. */
export function listeningPortsOf(pids: number[]): number[] {
  if (!pids.length) return [];
  let out = '';
  try { out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', pids.join(',')], { encoding: 'utf8' }); } catch { return []; }
  return [...new Set([...out.matchAll(/:(\d+) \(LISTEN\)/g)].map((m) => Number(m[1])))];
}

/** Every TCP LISTEN port on the machine, pid by port: to compare before and after. */
export function allListeners(): Map<number, number> {
  const res = new Map<number, number>();
  let out = '';
  try { out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { return res; }
  for (const line of out.split('\n').slice(1)) {
    const m = /^\S+\s+(\d+)\s.*:(\d+) \(LISTEN\)/.exec(line);
    if (m) res.set(Number(m[2]), Number(m[1]));
  }
  return res;
}
