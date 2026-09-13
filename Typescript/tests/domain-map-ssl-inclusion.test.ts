import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// Covers generateDomainMap()'s inclusion/exclusion rules — the mechanism
// that silently dropped netget.site from domain-map.json in production
// because it had no route `type` set yet (SSL was already configured, but
// that alone isn't enough: a domain "can live in the registry without being
// active in the Routing table", and generateDomainMap() skips it entirely
// in that case with no warning).
//
// registerDomain()/generateDomainMap() (kernel/domainStore.ts,
// runtime/domainMap.ts) always resolve a real monad via
// getNetgetMonadOrigin() -- there is no injectable test double for this
// path (unlike GatewayClaimsManager's own `ledger` option), so this is
// necessarily a real integration test against a disposable monad, never
// the real 'netget'-named one -- see gateway-setup-session.test.ts's own
// header comment for the incident (a real gateway's real ledger silently
// corrupted by a test that never scoped which monad "netget" resolved to)
// this exact isolation convention exists to prevent. NETGET_MONAD_NAME is
// set before any import.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `domain-map-ssl-test-${process.pid}.local`;

const TEST_MONAD_NAME = `domain-map-ssl-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const noRouteDomain = `no-route-${process.pid}.example`;
const halfCertDomain = `half-cert-${process.pid}.example`;
const readyDomain = `ready-${process.pid}.example`;

const { registerDomain, updateDomainType, updateDomainTarget } = await import('../src/kernel/domainStore.ts');
const { generateDomainMap, getDomainMapPath } = await import('../src/runtime/domainMap.ts');
const { startNetgetMonad, getNetgetMonadOrigin } = await import('../src/kernel/netgetMonadProcess.ts');
const { readMonadRecord, deleteMonadProcess } = await import('monad.ai');

// Reserve the exact port THIS monad will use, and arm the guard for it
// BEFORE calling startNetgetMonad() at all -- closes the window a guard
// armed only after the fact would leave open during monad.ai's own
// startup health probe. Nothing this process does from this line on is
// unobserved.
const reservedPort = await reservePort();
const expectedOrigin = `http://127.0.0.1:${reservedPort}`;
const originGuard = installMonadOriginGuard([expectedOrigin]);

const startStatus = await startNetgetMonad({ port: reservedPort });
assert.ok(startStatus.running, `isolated test monad must actually start: ${startStatus.message}`);

// Real isolation check, not just trust in the env var: this test's own
// monad must be registered under its OWN unique name, and (when a real
// 'netget'-named monad happens to also be running on this machine) must
// resolve to a genuinely different port — proves this run never fell
// through to the ambient process, rather than assuming NETGET_MONAD_NAME
// alone was enough.
const ownRecord = await readMonadRecord(TEST_MONAD_NAME);
assert.ok(ownRecord, 'the disposable monad must be registered under its own unique name');
assert.equal(ownRecord!.port, reservedPort, 'the disposable monad must have landed on the exact port reserved for it');
const resolvedOrigin = await getNetgetMonadOrigin();
assert.equal(resolvedOrigin, expectedOrigin, 'getNetgetMonadOrigin() must resolve to THIS test\'s own disposable monad');
const realRecord = await readMonadRecord('netget').catch(() => null);
if (realRecord) {
  assert.notEqual(ownRecord!.port, realRecord.port, 'must never resolve to the real ambient "netget" monad\'s port');
}

try {
  // 1) Registered, SSL fully configured, but no route type -> must be excluded.
  await registerDomain(
      noRouteDomain, noRouteDomain, 'admin@neurons.me', 'letsencrypt',
      `/etc/letsencrypt/live/${noRouteDomain}/fullchain.pem`,
      `/etc/letsencrypt/live/${noRouteDomain}/privkey.pem`,
      '', '', '', 'test-owner',
  );

  // 2) Registered with a route type but only a cert path, no key -> included,
  //    but ssl.enabled must be false (never present a half-configured cert).
  await registerDomain(
      halfCertDomain, halfCertDomain, 'admin@neurons.me', 'letsencrypt',
      `/etc/letsencrypt/live/${halfCertDomain}/fullchain.pem`, '',
      '127.0.0.1:9000', 'server', '', 'test-owner',
  );

  // 3) Fully configured: route + both cert paths -> included with ssl.enabled true.
  await registerDomain(
      readyDomain, readyDomain, 'admin@neurons.me', 'letsencrypt',
      `/etc/letsencrypt/live/${readyDomain}/fullchain.pem`,
      `/etc/letsencrypt/live/${readyDomain}/privkey.pem`,
      '127.0.0.1:9001', 'server', '', 'test-owner',
  );

  await generateDomainMap();
  const map = JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8'));

  assert.equal(map.domains[noRouteDomain], undefined, 'a domain with no route type must not appear in domain-map.json at all');

  assert.ok(map.domains[halfCertDomain], 'a routed domain must appear even with an incomplete cert');
  assert.equal(map.domains[halfCertDomain].ssl.enabled, false, 'ssl.enabled must be false when only one of cert/key is set');

  assert.ok(map.domains[readyDomain]);
  assert.equal(map.domains[readyDomain].ssl.enabled, true);
  assert.equal(map.domains[readyDomain].ssl.cert, `/etc/letsencrypt/live/${readyDomain}/fullchain.pem`);
  assert.equal(map.domains[readyDomain].ssl.key, `/etc/letsencrypt/live/${readyDomain}/privkey.pem`);
  assert.equal(map.domains[readyDomain].target, '127.0.0.1:9001');

  console.log('domain-map-ssl-inclusion ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
