/**
 * monad-statedir-lock-hygiene.test.ts -- the lock test must leave nothing behind, passing or failing.
 *
 * It started two monads under one name and relied on the one pid in a shared record to stop them: the other one stayed alive,
 * listening on `*:port`, one per run. This runs the lock test as a child process, once normally and once with a failure
 * injected while both monads are alive, and after each run requires: the child exited as expected, no process carries its
 * monad's name, and no TCP listener that was not there before is left.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidsWithEnv, killAll, allListeners, listeningPortsOf } from './helpers/processHygiene.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const target = path.join(here, 'monad-statedir-lock.test.ts');

async function run(label: string, env: Record<string, string>, expectExit: 'ok' | 'fail') {
  const before = allListeners();
  const child = spawn(process.execPath, [tsx, target], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const childPid = child.pid!;
  const code: number = await new Promise((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  // the monad name carries the pid of the process that ran the test; that process is the tsx child (or its node child)
  const leftovers = pidsWithEnv('MONAD_NAME', 'statedir-lock-test-', { prefix: true });
  const ports = listeningPortsOf(leftovers);
  const after = allListeners();
  const newListeners = [...after.keys()].filter((p) => !before.has(p));
  const stuck = leftovers.length ? await killAll(leftovers) : [];   // never leave them, whatever the verdict
  assert.equal(expectExit === 'ok' ? code === 0 : code !== 0, true, `${label}: exit code ${code}\n${out.slice(-600)}`);
  assert.deepEqual(leftovers, [], `${label}: processes left alive after the test ended (pids ${leftovers.join(',')}, ports ${ports.join(',')})`);
  assert.deepEqual(newListeners, [], `${label}: listening ports left open: ${newListeners.join(',')}`);
  assert.deepEqual(stuck, []);
  void childPid;
}

await run('passing run', {}, 'ok');
await run('failing run (failure injected while both monads are alive)', { STATEDIR_LOCK_TEST_FAIL: 'after-start' }, 'fail');
console.log('monad-statedir-lock-hygiene: ok');
process.exit(0);
