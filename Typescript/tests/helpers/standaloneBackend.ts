// standaloneBackend.ts -- starts THE standalone backend (src/htmls/Netget-REACT/backend/proxy.js, the process
// `netget backend-start` runs on :3000) as a child process, on disposable data, and proves it is the disposable one
// before anything may be written to it.
//
// Why a child process and not an in-process harness: what runs on the machine is that entry point, with its own
// mounting order and its own gate. A harness that mounts the same routers behind another gate verifies the harness.
//
// Isolation, all of it set on the CHILD's environment (and mirrored on this process, so the parent reads the same
// claims file and monad record the child writes):
//   NETGET_DATA_DIR   a temp dir        (domain store projection, runtime/, claims, xConfig)
//   HOME / MONADS_HOME a temp dir       (monad records live under ~/.monad/monads)
//   NETGET_MONAD_NAME a unique name     (never the machine's `netget` monad)
//   NETGET_MONAD_NAMESPACE a marker     (random: no real configuration has it) -- or, with defaultNamespace, left
//                                       unset so the instance runs under the machine's own default (`localhost`)
//   PORT              a reserved port
//
// The proof (assertDisposable): the listener on the port is a descendant of the process THIS run spawned, and
// GET /main-server-namespace answers the namespace this run configured (the marker, or `localhost` in default mode, where
// the process ownership is what tells it from a real backend). `send()` refuses every request that is not a GET until the
// proof has been made against that origin.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROXY_ENTRY = path.resolve(here, '../../src/htmls/Netget-REACT/backend/proxy.js');

export interface DisposableStandalone {
  origin: string;
  port: number;
  /** The namespace this instance answers with: a random marker, or `localhost` in default-namespace mode. */
  namespace: string;
  marker: string;
  monadName: string;
  dataDir: string;
  tmp: string;
  child: ChildProcess;
  /** Throws unless the backend at `origin` answers with this instance's marker. */
  assertDisposable(): Promise<void>;
  /** fetch, with the guard: anything that is not GET/HEAD is refused until the marker has been proven. */
  send(method: string, urlPath: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

function descendantsOf(root: number): Set<number> {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const out = new Set<number>([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, ppid] of rows) if (pid && out.has(ppid) && !out.has(pid)) { out.add(pid); changed = true; }
  }
  return out;
}

function listenerPids(port: number): number[] {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  } catch { return []; }
}

export async function startDisposableStandalone(options: { env?: Record<string, string>; port?: number; defaultNamespace?: boolean } = {}): Promise<DisposableStandalone> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-standalone-'));
  const dataDir = path.join(tmp, 'netget-data');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const marker = `marker-${crypto.randomBytes(6).toString('hex')}.test`;
  const monadName = `standalone-test-${process.pid}-${Date.now()}`;
  const port = options.port ?? await freePort();

  const isolated: Record<string, string> = {
    NETGET_DATA_DIR: dataDir,
    HOME: home,
    MONADS_HOME: path.join(home, '.monad', 'monads'),
    NETGET_MONAD_NAME: monadName,
    ...(options.defaultNamespace ? {} : { NETGET_MONAD_NAMESPACE: marker }),
    NETGET_MAIN_SERVER_RECONCILE_MS: '0',
    PORT: String(port),
    NODE_ENV: 'test',
    ...(options.env ?? {}),
  };
  // the parent reads the same claims file and monad record as the child writes
  for (const [k, v] of Object.entries(isolated)) process.env[k] = v;
  if (options.defaultNamespace) delete process.env.NETGET_MONAD_NAMESPACE;
  delete process.env.NETGET_MONAD_ORIGIN;
  const namespace = options.defaultNamespace ? 'localhost' : marker;

  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve('tsx/cli');
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') childEnv[k] = v;
  // nothing that could point the child at the real machine survives
  for (const k of ['NETGET_MONAD_ORIGIN', 'NETGET_GATEWAY_SEED', 'SEED', 'ME_SEED', 'MONAD_INTERNAL_TOKEN', 'NETGET_LOCAL']) delete childEnv[k];
  if (options.defaultNamespace) delete childEnv.NETGET_MONAD_NAMESPACE;
  Object.assign(childEnv, isolated);

  const child = spawn(process.execPath, [tsxCli, PROXY_ENTRY], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout?.on('data', (d) => { log += String(d); });
  child.stderr?.on('data', (d) => { log += String(d); });

  const origin = `http://127.0.0.1:${port}`;
  let proven = false;

  const assertDisposable = async () => {
    const mine = descendantsOf(child.pid ?? -1);
    const owners = listenerPids(port);
    if (!owners.length || !owners.every((pid) => mine.has(pid))) {
      throw new Error(`REFUSING TO WRITE: the listener on ${origin} (pids ${JSON.stringify(owners)}) is not a process this run started`);
    }
    const res = await fetch(`${origin}/main-server-namespace`).catch(() => null);
    const json: any = res ? await res.json().catch(() => null) : null;
    if (!json || json.namespace !== namespace) {
      throw new Error(`REFUSING TO WRITE: ${origin} did not prove it is the disposable backend (namespace=${JSON.stringify(json?.namespace)}, wanted ${JSON.stringify(namespace)})`);
    }
    proven = true;
  };

  const send = async (method: string, urlPath: string, body?: unknown, headers: Record<string, string> = {}) => {
    const m = method.toUpperCase();
    if (m !== 'GET' && m !== 'HEAD' && !proven) await assertDisposable();
    return fetch(`${origin}${urlPath}`, {
      method: m,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 8000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    // the monad this entry started (named, unique) is stopped by its own record
    try {
      const { stopNetgetMonad } = await import('../../src/kernel/netgetMonadProcess.ts');
      await stopNetgetMonad();
    } catch { /* already gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  // ready: the entry answers and has started its monad
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`proxy.js exited (${child.exitCode}) before it was ready:\n${log.slice(-1500)}`);
    const ok = await fetch(`${origin}/healthcheck`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) { await stop(); throw new Error(`proxy.js not ready in time:\n${log.slice(-1500)}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  await assertDisposable();

  return { origin, port, namespace, marker, monadName, dataDir, tmp, child, assertDisposable, send, stop };
}
