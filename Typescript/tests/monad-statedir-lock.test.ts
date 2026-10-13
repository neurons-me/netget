/**
 * monad-statedir-lock.test.ts — proves the guarantee installationAuthorization.ts's
 * whole reclaim design depends on: exactly one live process may ever hold a
 * given monad stateDir (kernel/manager.ts's acquireStateDirLock(), monad.ai).
 *
 * Confirmed by investigation before this fix existed: startMonadProcess()'s
 * OWN "already running" check (readMonadRecord + pidAlive) has a real
 * TOCTOU race — two concurrent calls under the same name can both proceed.
 * What accidentally prevented two live processes from coexisting was both
 * racing calls usually landing on the SAME free port and one losing the
 * OS-level bind — not a designed guarantee. This test deliberately hands
 * the two concurrent starts DIFFERENT explicit ports, removing that
 * accidental protection, to prove the REAL fix (a lock acquired inside
 * getKernel() itself, not the launcher-side check) is what actually closes
 * this — exactly the scenario the review asked to be tested directly
 * rather than assumed from the "different name" case already covered
 * elsewhere.
 *
 * Real, disposable monad processes throughout, never the real ambient one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reservePort } from '../src/kernel/testing/reservePort.ts';
import { pidsWithEnv, killAll, listeningPortsOf } from './helpers/processHygiene.ts';

// The monad records and state live under HOME: a temp one, so a run leaves nothing in the machine's ~/.monad and a
// leftover record cannot be mistaken for a live monad.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'statedir-lock-home-'));
process.env.HOME = tmpHome;
process.env.MONADS_HOME = path.join(tmpHome, '.monad', 'monads');

const { startMonadProcess, getMonadStatus, deleteMonadProcess } = await import('monad.ai');

const NAME = `statedir-lock-test-${process.pid}-${Date.now()}`;
// STATEDIR_LOCK_TEST_FAIL=after-start: throw while both processes are alive, to prove the cleanup runs on failure too
// (tests/monad-statedir-lock-hygiene.test.ts is the only thing that sets it).
const INJECT = process.env.STATEDIR_LOCK_TEST_FAIL === 'after-start';
const portA = await reservePort();
const portB = await reservePort();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  // ── Guarantee 1: two genuinely concurrent starts, different ports,
  // same name (same stateDir) — at most one process ever ends up alive. ──
  const [resA, resB] = await Promise.allSettled([
    startMonadProcess({ name: NAME, port: portA, namespace: 'statedir-lock-test.local', seed: 'statedir-lock-seed' }),
    startMonadProcess({ name: NAME, port: portB, namespace: 'statedir-lock-test.local', seed: 'statedir-lock-seed' }),
  ]);

  // Whichever of the two calls actually returned a record (fulfilled),
  // check its OWN reported pid directly — not the shared monad.json record,
  // which the loser's own write could still have overwritten.
  const fulfilled = [resA, resB].filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof startMonadProcess>>> => r.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1, 'at least one of the two concurrent starts must have returned a record');

  await sleep(2000); // let both genuinely boot (or crash) for real
  if (INJECT) throw new Error('injected failure after both starts (hygiene check)');

  const statuses = await Promise.all(fulfilled.map((r) => getMonadStatus(r.value.record)));
  const aliveCount = statuses.filter((s) => s.pidAlive && s.healthy).length;
  assert.equal(
    aliveCount, 1,
    `exactly one process must end up genuinely alive and healthy on a stateDir race with DIFFERENT ports — got ${aliveCount} ` +
    `(statuses: ${JSON.stringify(statuses.map((s) => ({ pidAlive: s.pidAlive, healthy: s.healthy, status: s.status })))})`,
  );

  // The survivor must still be reachable over its own real HTTP surface.
  const survivorIndex = statuses.findIndex((s) => s.pidAlive && s.healthy);
  const survivorRecord = fulfilled[survivorIndex].value.record;
  const health = await fetch(`${survivorRecord.endpoint}/api/v1/gateway/nonexistent.local/authority`);
  assert.equal(health.status, 200, 'the surviving process must genuinely be serving real HTTP, not just reporting alive');

  // ── Guarantee 2 (already covered from a different angle by
  // monad.ai's own processInterruption.process.test.ts, re-checked here
  // end to end through the real CLI process-management path this repo
  // actually uses): after a real crash, a fresh start recovers cleanly. ──
  await deleteMonadProcess(NAME).catch(() => {});
  const recovered = await startMonadProcess({ name: NAME, namespace: 'statedir-lock-test.local', seed: 'statedir-lock-seed' });
  await sleep(1000);
  const recoveredStatus = await getMonadStatus(recovered.record);
  assert.ok(recoveredStatus.pidAlive && recoveredStatus.healthy, 'a fresh start after full cleanup must succeed normally');
} finally {
  // The record names ONE pid, and in this race two processes were started under one name: whichever lost the write is
  // not in it. Everything that was started is found by what it is (its environment carries the name) and stopped.
  await deleteMonadProcess(NAME).catch(() => {});
  const mine = pidsWithEnv('MONAD_NAME', NAME);
  const ports = listeningPortsOf(mine);
  const stuck = await killAll(mine);
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (stuck.length) {
    console.error(`monad-statedir-lock: processes that would not stop: ${stuck.join(', ')} (ports ${ports.join(', ')})`);
    process.exitCode = 1;
  }
}

console.log('monad-statedir-lock ok');
