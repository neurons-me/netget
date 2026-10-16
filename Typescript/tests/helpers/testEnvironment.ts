// testEnvironment.ts -- a throwaway place to test apps and data: one monad, its own storage, its own namespace, its own
// identities. Created in one call, removed in one call. No nginx, no gateway, never the machine's monad.
//
//   const env = await createTestEnvironment({ identities: ['alice', 'bob'], seed: { 'profile.motto': 'hello' } });
//   env.namespace   the namespace this environment IS (a random marker: no real configuration has it)
//   env.transport   http://127.0.0.1:<port>   where it answers (the port is the transport, not the namespace)
//   env.identities  claimed in it, each with its own key (sign() for signed requests)
//   await env.stop()   -> { processGone, portClosed, storageRemoved }   (throws if any of the three is false)
//
//   await withTestEnvironment({ ... }, async (env) => { ... })   stops and removes it even when the callback throws.
//
// What isolation this gives, and what it does not:
//   * a separate PROCESS and a separate STORAGE directory (HOME, MONADS_HOME, NETGET_DATA_DIR and the monad's state all
//     under one temp dir this call created). Nothing of the machine's monad is read or written.
//   * it does NOT test the gateway: nginx/OpenResty, certificates and the router are another test (disposableOpenResty).
//   * stopping removes the process and the directory. It does not "purge a namespace" from anywhere else: there is no
//     shared store here to purge, which is the point.
// Cleanup touches ONLY the process this call spawned (by the PID it holds) and the directory it created, and is also
// registered for process exit / SIGINT / SIGTERM so an aborted run does not leave either behind.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { claimIdentityWithKey, type TestAdmin } from './testIdentities.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(here, 'testEnvironmentChild.mts');
const DIR_PREFIX = 'netget-testenv-';

export interface TestEnvironmentOptions {
  /** Usernames to claim in the environment (each gets a signing key and a device key). */
  identities?: Array<string | { username: string; secret?: string }>;
  /** Values written to the environment's own namespace (path -> value) and read back before it is returned. */
  seed?: Record<string, unknown>;
  /** Extra environment for the monad process (never able to point it at the machine: see FORBIDDEN). */
  env?: Record<string, string>;
}

export interface TestEnvironmentState { processAlive: boolean; listening: boolean; storageExists: boolean }
export interface TestEnvironmentClosure { processGone: boolean; portClosed: boolean; storageRemoved: boolean }

export interface TestEnvironment {
  namespace: string;
  transport: string;
  port: number;
  pid: number;
  dir: string;
  identities: TestAdmin[];
  /** Reads a path of the environment's namespace (JSON), through its own transport. */
  read(urlPath: string): Promise<any>;
  status(): TestEnvironmentState;
  stop(): Promise<TestEnvironmentClosure>;
}

// Variables that could make the child reach a real machine. They are removed from its environment, not just overridden.
const FORBIDDEN = ['NETGET_MONAD_ORIGIN', 'NETGET_GATEWAY_SEED', 'NETGET_LOCAL', 'SEED', 'ME_SEED', 'MONAD_INTERNAL_TOKEN',
  'NETGET_RELEASE_LINK', 'MONAD_STATE_DIR', 'MONAD_CLAIM_DIR'];

const live = new Set<{ child: ChildProcess; dir: string; tree: Set<number> }>();
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  const sweep = () => {
    for (const e of live) {
      for (const p of new Set([...e.tree, ...(e.child.pid ? [e.child.pid] : [])])) { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } }
      try { if (path.basename(e.dir).startsWith(DIR_PREFIX)) fs.rmSync(e.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    live.clear();
  };
  process.on('exit', sweep);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { sweep(); process.exit(130); });
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(port, '127.0.0.1', () => { c.destroy(); resolve(true); });
    c.on('error', () => resolve(false));
  });
}
function listenerPids(port: number): number[] {
  try { return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number); }
  catch { return []; }
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
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

export async function createTestEnvironment(options: TestEnvironmentOptions = {}): Promise<TestEnvironment> {
  hook();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), DIR_PREFIX));
  const home = path.join(dir, 'home');
  const dataDir = path.join(dir, 'netget-data');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
  const namespace = `env-${crypto.randomBytes(5).toString('hex')}.test`;

  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') childEnv[k] = v;
  for (const k of FORBIDDEN) delete childEnv[k];
  Object.assign(childEnv, options.env ?? {}, {
    HOME: home, MONADS_HOME: path.join(home, '.monad', 'monads'), NETGET_DATA_DIR: dataDir,
    TEST_ENV_DIR: dir, TEST_ENV_NAMESPACE: namespace, NODE_ENV: 'test',
  });
  for (const k of FORBIDDEN) delete childEnv[k];

  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), CHILD], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.resolve(here, '../..') });
  const entry = { child, dir, tree: new Set<number>() };
  live.add(entry);
  let log = '';
  child.stderr?.on('data', (d) => { log += String(d); });

  const teardown = async (): Promise<TestEnvironmentClosure> => {
    const pid = child.pid ?? -1;
    let port = 0;
    try { port = Number(JSON.parse(fs.readFileSync(path.join(dir, 'port.json'), 'utf8')).port); } catch { /* not recorded */ }
    const tree = new Set<number>([...entry.tree, ...(alive(pid) ? descendantsOf(pid) : [])]);
    const anyAlive = () => [...tree].some((p) => alive(p));
    if (anyAlive()) {
      for (const p of tree) { try { process.kill(p, 'SIGTERM'); } catch { /* gone */ } }
      for (let i = 0; i < 50 && anyAlive(); i += 1) await new Promise((r) => setTimeout(r, 100));
      if (anyAlive()) {
        for (const p of tree) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
        for (let i = 0; i < 30 && anyAlive(); i += 1) await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (path.basename(dir).startsWith(DIR_PREFIX)) fs.rmSync(dir, { recursive: true, force: true });
    live.delete(entry);
    return {
      processGone: !anyAlive(),
      portClosed: port ? !(await isListening(port)) && listenerPids(port).length === 0 : true,
      storageRemoved: !fs.existsSync(dir),
    };
  };

  let port = 0;
  try {
    const line: string = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`the test environment's monad did not start in 60s\n${log.slice(-600)}`)), 60_000);
      child.stdout?.on('data', (d) => {
        buf += String(d);
        const m = buf.match(/^TESTENV_READY (\{.*\})$/m);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the test environment's monad exited (${code}) before listening\n${log.slice(-600)}`)); });
    });
    const ready = JSON.parse(line);
    port = Number(ready.port);
    fs.writeFileSync(path.join(dir, 'port.json'), JSON.stringify({ port }));
    // proof of what this is: the listener is the process this call spawned, and it answers as the namespace we named
    const mine = descendantsOf(child.pid ?? -1);
    entry.tree = mine;
    const owners = listenerPids(port);
    if (!owners.length || !owners.every((p) => mine.has(p))) throw new Error(`REFUSING: the listener on :${port} (pids ${JSON.stringify(owners)}) is not a process this call started`);
    const monadPid = Number(ready.pid) || owners[0];
    const transport = `http://127.0.0.1:${port}`;
    const read = async (urlPath: string) => {
      const res = await fetch(`${transport}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`, { headers: { accept: 'application/json', 'x-forwarded-host': namespace } });
      return res.json().catch(() => null);
    };

    const identities: TestAdmin[] = [];
    for (const spec of options.identities ?? []) {
      const username = typeof spec === 'string' ? spec : spec.username;
      const secret = typeof spec === 'string' ? `${username}-test-secret` : (spec.secret ?? `${username}-test-secret`);
      identities.push(await claimIdentityWithKey(transport, username, secret, namespace));
    }
    for (const [p, value] of Object.entries(options.seed ?? {})) {
      const res = await fetch(`${transport}/`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-host': namespace },
        body: JSON.stringify({ operation: 'write', path: p, expression: p, value }),
      });
      if (!res.ok) throw new Error(`seed ${p}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    const env: TestEnvironment = {
      namespace, transport, port, pid: monadPid, dir, identities, read,
      status: () => ({ processAlive: alive(monadPid), listening: listenerPids(port).length > 0, storageExists: fs.existsSync(dir) }),
      async stop() {
        const closure = await teardown();
        if (!closure.processGone || !closure.portClosed || !closure.storageRemoved) {
          throw new Error(`test environment did not close cleanly: ${JSON.stringify(closure)}`);
        }
        return closure;
      },
    };
    return env;
  } catch (error) {
    await teardown().catch(() => undefined);
    throw error;
  }
}

/** Runs `fn` against a fresh environment and always removes it, also when `fn` throws; the closure is checked. */
export async function withTestEnvironment<T>(options: TestEnvironmentOptions, fn: (env: TestEnvironment) => Promise<T>): Promise<T> {
  const env = await createTestEnvironment(options);
  let result: T;
  try {
    result = await fn(env);
  } catch (error) {
    await env.stop().catch(() => undefined);
    throw error;
  }
  await env.stop();
  return result;
}
