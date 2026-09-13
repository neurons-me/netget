import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// Coverage for migrateLegacyDomains(): a deployment can have its real domain
// config sitting entirely in the legacy sqlite table while
// generateDomainMap() (runtime/domainMap.ts) only ever reads the kernel —
// this is the one-time bridge. Builds a throwaway sqlite fixture (via the
// sqlite3 CLI, same schema utils_sqlite3.ts creates) with the CLI, migrates
// it, then checks the rows landed in the kernel AND that the regenerated
// domain-map.json reflects them.

process.env.NETGET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-migrate-data-'));

const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'netget-migrate-sqlite-')), 'domains.db');

function createLegacyDb(): void {
    const sql = `
        CREATE TABLE domains (
            domain TEXT PRIMARY KEY, subdomain TEXT, email TEXT, sslMode TEXT,
            sslCertificate TEXT, sslCertificateKey TEXT, target TEXT, type TEXT,
            projectPath TEXT, rootDomain TEXT, owner TEXT, nginxConfig TEXT
        );
        INSERT INTO domains (domain, email, sslMode, sslCertificate, sslCertificateKey, target, type, owner)
        VALUES ('legacy-one.example', 'admin@neurons.me', 'letsencrypt', '/etc/letsencrypt/live/legacy-one.example/fullchain.pem', '/etc/letsencrypt/live/legacy-one.example/privkey.pem', '127.0.0.1:8181', 'server', 'owner-a');
        INSERT INTO domains (domain, email, sslMode, target, type, owner)
        VALUES ('legacy-two.example', 'admin@neurons.me', 'none', '127.0.0.1:8182', 'server', 'owner-b');
        INSERT INTO domains (domain, email, sslMode, target, type, owner)
        VALUES ('legacy-bareport.example', 'admin@neurons.me', 'none', '8181', 'server', 'owner-c');
        INSERT INTO domains (domain) VALUES ('');
    `;
    const r = spawnSync('sqlite3', [sqlitePath], { input: sql, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || `sqlite3 fixture setup failed (exit ${r.status})`);
}

createLegacyDb();

// migrateLegacyDomains()/getDomainByName() (kernel/domainStore.ts) always
// resolve a real monad via getNetgetMonadOrigin() -- no injectable test
// double for this path, so this is necessarily a real integration test
// against a disposable monad, NEVER the real 'netget'-named one — see
// gateway-setup-session.test.ts's own header comment for the incident
// this isolation convention exists to prevent. NETGET_MONAD_NAME is set
// before any import that could resolve one.
const TEST_MONAD_NAME = `migrate-legacy-domains-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { migrateLegacyDomains } = await import('../src/modules/NetGetX/Domains/migrateLegacyDomains.ts');
const { getDomainByName } = await import('../src/kernel/domainStore.ts');
const { getDomainMapPath } = await import('../src/runtime/domainMap.ts');
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
  // ── First run: migrates both real rows, skips the blank-domain row ────────
  const result = await migrateLegacyDomains(sqlitePath);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.migrated, 3);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 0);

  const one = await getDomainByName('legacy-one.example');
  assert.equal(one?.target, '127.0.0.1:8181');
  assert.equal(one?.type, 'server');
  assert.equal(one?.sslCertificate, '/etc/letsencrypt/live/legacy-one.example/fullchain.pem');
  assert.equal(one?.owner, 'owner-a');

  const two = await getDomainByName('legacy-two.example');
  assert.equal(two?.target, '127.0.0.1:8182');

  // A bare-port target ("8181", no host) breaks proxy_pass construction
  // downstream ("http://" .. target -> "http://8181", a 502 for every
  // request) — must be normalized to 127.0.0.1:<port> during migration.
  const bareport = await getDomainByName('legacy-bareport.example');
  assert.equal(bareport?.target, '127.0.0.1:8181', 'bare-port target must be normalized to host:port');

  // ── domain-map.json regenerated with both, real cert path preserved ───────
  const map = JSON.parse(fs.readFileSync(getDomainMapPath(), 'utf8'));
  assert.ok(map.domains['legacy-one.example'], 'domain-map must include the migrated domain');
  assert.equal(map.domains['legacy-one.example'].ssl.enabled, true);
  assert.equal(map.domains['legacy-one.example'].ssl.cert, '/etc/letsencrypt/live/legacy-one.example/fullchain.pem');
  assert.equal(map.domains['legacy-two.example'].ssl.enabled, false, 'sslMode=none must not fabricate an ssl block');

  // ── Re-running is safe: upserts instead of "already exists" errors ────────
  const secondRun = await migrateLegacyDomains(sqlitePath);
  assert.equal(secondRun.ok, true, secondRun.message);
  assert.equal(secondRun.migrated, 3);
  assert.equal(secondRun.errors.length, 0);

  console.log('migrate-legacy-domains ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
