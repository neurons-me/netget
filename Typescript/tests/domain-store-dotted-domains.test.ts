import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// registerDomain()/getDomains()/generateDomainMap() (kernel/domainStore.ts,
// runtime/domainMap.ts) always resolve a real monad via
// getNetgetMonadOrigin() -- no injectable test double for this path, so
// this is necessarily a real integration test against a disposable monad,
// NEVER the real 'netget'-named one — see gateway-setup-session.test.ts's
// own header comment for the incident this isolation convention exists to
// prevent. NETGET_MONAD_NAME is set before any import.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_MONAD_NAMESPACE = `domain-store-test-${process.pid}.local`;

const TEST_MONAD_NAME = `domain-store-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const netgetDomain = `netget-${process.pid}.site`;
const fulltrailerDomain = `fulltrailer-${process.pid}.com.mx`;

const {
    getDomains,
    getDomainByName,
    registerDomain,
    updateSSLCertificatePaths,
} = await import('../src/kernel/domainStore.ts');
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

// Real isolation check, not just trust in the env var — see
// domain-map-ssl-inclusion.test.ts's identical comment for the full
// reasoning.
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
  await registerDomain(
      netgetDomain,
      netgetDomain,
      'admin@neurons.me',
      'letsencrypt',
      '/etc/letsencrypt/live/netget.site/fullchain.pem',
      '/etc/letsencrypt/live/netget.site/privkey.pem',
      '3432',
      'server',
      '',
      'main-server'
  );

  const byName = await getDomainByName(netgetDomain);
  assert.equal(byName?.domain, netgetDomain);
  assert.equal(byName?.type, 'server');
  assert.equal(byName?.owner, 'main-server');

  await registerDomain(
      fulltrailerDomain,
      '',
      'admin@neurons.me',
      'none',
      '',
      '',
      '',
      'proxy',
      '',
      'semantic-surface'
  );

  await updateSSLCertificatePaths(
      fulltrailerDomain,
      '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem',
      '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem'
  );

  const domains = await getDomains();
  assert.ok(domains.length >= 2);

  const netgetSite = domains.find((domain) => domain.domain === netgetDomain);
  assert.equal(netgetSite?.sslCertificate, '/etc/letsencrypt/live/netget.site/fullchain.pem');
  assert.equal(netgetSite?.sslCertificateKey, '/etc/letsencrypt/live/netget.site/privkey.pem');

  const fulltrailer = domains.find((domain) => domain.domain === fulltrailerDomain);
  assert.equal(fulltrailer?.target || '', '');
  assert.equal(fulltrailer?.type, 'proxy');
  assert.equal(fulltrailer?.sslMode, 'letsencrypt');
  assert.equal(fulltrailer?.sslCertificate, '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem');
  assert.equal(fulltrailer?.sslCertificateKey, '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem');

  await generateDomainMap();
  const domainMap = JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8'));
  assert.deepEqual(domainMap.domains[fulltrailerDomain], {
      type: 'proxy',
      protocol: 'http',
      ssl: {
          enabled: true,
          cert: '/etc/letsencrypt/live/fulltrailer.com.mx/fullchain.pem',
          key: '/etc/letsencrypt/live/fulltrailer.com.mx/privkey.pem',
      },
  });

  console.log('domain-store-dotted-domains ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
