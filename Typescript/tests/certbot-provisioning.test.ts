import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// End-to-end coverage of the certbot provisioning/renewal command mechanism,
// using fake `sudo`/`certbot` binaries on PATH (same technique as
// tests/openresty-config-path.test.ts and tests/certbot-acl-fix.test.ts) so
// it runs without root or a real certbot install, on any dev machine.
//
// This is what would have caught, before it ever reached production:
//   - provisionCert() must invoke `certbot certonly --webroot`, and must
//     only update the domain store when certbot actually succeeds.
//   - renewSSLCertificate() (SSLCertificates.ts) used to hand-build
//     `certbot renew --nginx -d <domain>`, which certbot rejects outright
//     (`renew` doesn't accept `-d`). It must now go through the same
//     `certonly` path as first-time provisioning.

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fakebin-'));
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
const code = Number(process.env.NETGET_TEST_CERTBOT_EXIT || 0);
if (code === 0) {
    const dIndex = args.indexOf('-d');
    const domain = dIndex >= 0 ? args[dIndex + 1] : null;
    if (domain) {
        const dir = path.join(process.env.NETGET_LETSENCRYPT_LIVE_DIR, domain);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'fullchain.pem'), 'fake-fullchain');
        fs.writeFileSync(path.join(dir, 'privkey.pem'), 'fake-privkey');
    }
}
process.exit(code);
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
process.env.NETGET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_LETSENCRYPT_LIVE_DIR = path.join(tmpBin, 'le-live');
process.env.NETGET_LETSENCRYPT_ARCHIVE_DIR = path.join(tmpBin, 'le-archive');

const { provisionCert, getLetsEncryptCertPath, getLetsEncryptKeyPath } =
    await import('../src/modules/NetGetX/Domains/SSL/Certbot/certbotProvision.ts');
const { registerDomain, getDomainByName } = await import('../src/kernel/domainStore.ts');

// provisionCert() is only ever called on a domain that's already registered
// (mainServer.cli.ts and the Domains menu both register first, then
// provision) — getDomainByName() only recognizes a record once it has a
// `target`, `type`, or `owner`, so an SSL-only write to an unregistered
// domain would be invisible regardless of whether provisioning succeeded.
await registerDomain('ok.example', 'ok.example', 'admin@neurons.me', 'none', '', '', '127.0.0.1:9000', 'server', '', 'test-owner');
await registerDomain('fail.example', 'fail.example', 'admin@neurons.me', 'none', '', '', '127.0.0.1:9001', 'server', '', 'test-owner');

// ── Success path ────────────────────────────────────────────────────────
const okResult = await provisionCert('ok.example', 'admin@neurons.me');
assert.equal(okResult.ok, true, okResult.message);
assert.equal(okResult.certPath, getLetsEncryptCertPath('ok.example'));
assert.equal(okResult.keyPath, getLetsEncryptKeyPath('ok.example'));

const certbotCalls = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l.startsWith('certbot '));
assert.equal(certbotCalls.length, 1);
assert.match(certbotCalls[0], /^certbot certonly --webroot -w \S+ -d ok\.example --non-interactive --agree-tos -m admin@neurons\.me --expand$/);

const okRecord = await getDomainByName('ok.example');
assert.equal(okRecord?.sslCertificate, getLetsEncryptCertPath('ok.example'), 'domain store must be updated on success');
assert.equal(okRecord?.sslCertificateKey, getLetsEncryptKeyPath('ok.example'));
assert.equal(okRecord?.sslMode, 'letsencrypt');

// ── Failure path: certbot exits non-zero -> SSL fields left untouched ─────
fs.writeFileSync(logPath, '');
process.env.NETGET_TEST_CERTBOT_EXIT = '1';
const failResult = await provisionCert('fail.example', 'admin@neurons.me');
assert.equal(failResult.ok, false);
assert.match(failResult.message, /certbot failed/i);

const failRecord = await getDomainByName('fail.example');
assert.ok(failRecord, 'the pre-existing registration must still be there');
assert.equal(failRecord?.sslCertificate || '', '', 'a failed certbot run must never write SSL cert paths to the domain store');
delete process.env.NETGET_TEST_CERTBOT_EXIT;

// ── Renewal delegates to the same certonly path, never `renew -d` ─────────
fs.writeFileSync(logPath, '');
const { renewSSLCertificate } = await import('../src/modules/NetGetX/Domains/SSL/SSLCertificates.ts');
const renewed = await renewSSLCertificate('ok.example', 'admin@neurons.me');
assert.equal(renewed, true);

const renewCalls = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l.startsWith('certbot '));
assert.equal(renewCalls.length, 1);
assert.match(renewCalls[0], /certonly/, 'renewal must go through certonly, matching how the cert was first issued');
assert.doesNotMatch(renewCalls[0], /\brenew\b/, 'must never construct the broken `certbot renew -d <domain>` invocation');

console.log('certbot-provisioning ok');
