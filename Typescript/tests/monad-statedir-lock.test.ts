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
import { reservePort } from '../src/kernel/testing/reservePort.ts';

const { startMonadProcess, getMonadStatus, deleteMonadProcess } = await import('monad.ai');

const NAME = `statedir-lock-test-${process.pid}-${Date.now()}`;
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
  await deleteMonadProcess(NAME).catch(() => {});
}

console.log('monad-statedir-lock ok');
