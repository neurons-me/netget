import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMonadOriginGuard } from '../src/kernel/testing/monadOriginGuard.ts';
import { reservePort } from '../src/kernel/testing/reservePort.ts';

// Wildcard/DNS-01 coverage for provisionCert(), same fake-bin technique as
// tests/certbot-provisioning.test.ts. What this guards against:
//   - wildcard: true without dnsProvider must be rejected before ever
//     shelling out to certbot (HTTP-01/webroot cannot validate wildcards).
//   - the google DNS-01 path must invoke `certbot certonly --dns-google
//     -d <domain> -d *.<domain>`, never `--manual --preferred-challenges
//     dns` (the old wizard's invocation — the whole point of this path is
//     that certbot renew can satisfy it unattended, which --manual never
//     can, regardless of how it's spelled).
//   - it must NOT create/touch the webroot directory — DNS-01 doesn't need it.

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fakebin-dns-'));
const logPath = path.join(tmpBin, 'invocations.log');
fs.writeFileSync(logPath, '');

function writeFakeBin(name: string, body: string): void {
    const p = path.join(tmpBin, name);
    fs.writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, 'utf8');
    fs.chmodSync(p, 0o755);
}

writeFakeBin('certbot', `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NETGET_TEST_LOG, 'certbot ' + args.join(' ') + '\\n');
const dIndex = args.indexOf('-d');
const domain = dIndex >= 0 ? args[dIndex + 1] : null;
if (domain) {
    const dir = path.join(process.env.NETGET_LETSENCRYPT_LIVE_DIR, domain);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fullchain.pem'), 'fake-fullchain');
    fs.writeFileSync(path.join(dir, 'privkey.pem'), 'fake-privkey');
}
process.exit(0);
`);

writeFakeBin('sudo', `
const fs = require('fs');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NETGET_TEST_LOG, 'sudo ' + args.join(' ') + '\\n');
const [cmd, ...rest] = args;
const r = spawnSync(cmd, rest, { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
`);

process.env.PATH = `${tmpBin}${path.delimiter}${process.env.PATH}`;
process.env.NETGET_TEST_LOG = logPath;
process.env.NETGET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-dns-'));
process.env.NETGET_MONAD_NAMESPACE = `certbot-dns-google-test-${process.pid}.local`;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = path.join(tmpBin, 'le-live');
process.env.NETGET_LETSENCRYPT_ARCHIVE_DIR = path.join(tmpBin, 'le-archive');
const wildDomain = `wild-${process.pid}.example`;

// registerDomain()/getDomainByName() (kernel/domainStore.ts) always
// resolve a real monad via getNetgetMonadOrigin() -- no injectable test
// double for this path, so this is necessarily a real integration test
// against a disposable monad, NEVER the real 'netget'-named one — see
// gateway-setup-session.test.ts's own header comment for the incident
// this isolation convention exists to prevent. NETGET_MONAD_NAME is set
// before any import that could resolve one.
const TEST_MONAD_NAME = `certbot-dns-google-test-${process.pid}-${Date.now()}`;
process.env.NETGET_MONAD_NAME = TEST_MONAD_NAME;

const { provisionCert, getLetsEncryptCertPath, getLetsEncryptKeyPath } =
    await import('../src/modules/NetGetX/Domains/SSL/Certbot/certbotProvision.ts');
const { registerDomain, getDomainByName } = await import('../src/kernel/domainStore.ts');
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
  await registerDomain(wildDomain, wildDomain, 'admin@neurons.me', 'none', '', '', '127.0.0.1:9002', 'server', '', 'test-owner');

  // ── wildcard without dnsProvider is rejected before touching certbot ──────
  const missingProvider = await provisionCert(wildDomain, 'admin@neurons.me', { wildcard: true });
  assert.equal(missingProvider.ok, false);
  assert.match(missingProvider.message, /requires a dnsProvider/i);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim(), '', 'must not shell out at all when the options are invalid');

  // ── wildcard + google: correct certbot invocation ──────────────────────────
  const result = await provisionCert(wildDomain, 'admin@neurons.me', { wildcard: true, dnsProvider: 'google' });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.certPath, getLetsEncryptCertPath(wildDomain));
  assert.equal(result.keyPath, getLetsEncryptKeyPath(wildDomain));

  const certbotCalls = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l.startsWith('certbot '));
  assert.equal(certbotCalls.length, 1);
  assert.equal(
      certbotCalls[0],
      `certbot certonly --dns-google -d ${wildDomain} -d *.${wildDomain} --non-interactive --agree-tos -m admin@neurons.me --expand`,
  );
  assert.doesNotMatch(certbotCalls[0], /--manual/, 'must never fall back to the unattended-incapable manual/dns wizard invocation');
  assert.doesNotMatch(certbotCalls[0], /--webroot/, 'DNS-01 must not also pass --webroot');

  const record = await getDomainByName(wildDomain);
  assert.equal(record?.sslCertificate, getLetsEncryptCertPath(wildDomain), 'domain store must be updated on success, same as the webroot path');
  assert.equal(record?.sslMode, 'letsencrypt');

  console.log('certbot-dns-google ok');
} finally {
  originGuard.uninstall();
  await deleteMonadProcess(TEST_MONAD_NAME).catch(() => {});
}
