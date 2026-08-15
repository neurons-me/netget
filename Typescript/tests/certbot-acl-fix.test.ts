import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers ensureCertReadableByGatewayWorker() — the fix for the second bug
// found alongside the missing domain-map entry: certbot writes privkey.pem
// root:root mode 600, which the non-root OpenResty worker (www-data) can't
// read. Without this fix the Lua ssl_certificate_by_lua_block silently
// falls back to the default cert with no visible error.
//
// Fake `sudo` and `setfacl` binaries are put on PATH (same technique as
// tests/openresty-config-path.test.ts's fake openresty binary) so this runs
// on any dev machine without touching the real filesystem or needing root.

const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-fakebin-'));
const logPath = path.join(tmpBin, 'invocations.log');
fs.writeFileSync(logPath, '');

function writeFakeBin(name: string, body: string): void {
    const p = path.join(tmpBin, name);
    fs.writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, 'utf8');
    fs.chmodSync(p, 0o755);
}

writeFakeBin('setfacl', `
const fs = require('fs');
fs.appendFileSync(process.env.NETGET_TEST_LOG, 'setfacl ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(Number(process.env.NETGET_TEST_SETFACL_EXIT || 0));
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
process.env.NETGET_LETSENCRYPT_LIVE_DIR = path.join(tmpBin, 'le-live');
process.env.NETGET_LETSENCRYPT_ARCHIVE_DIR = path.join(tmpBin, 'le-archive');

const { ensureCertReadableByGatewayWorker } = await import('../src/modules/NetGetX/Domains/SSL/Certbot/certbotProvision.ts');

// ── Case 1: non-Linux platform -> no-op, no sudo/setfacl invoked ──────────
const macResult = ensureCertReadableByGatewayWorker('netget.site', { platform: 'darwin' });
assert.equal(macResult.ok, true);
assert.match(macResult.message, /skipped/i);
assert.equal(fs.readFileSync(logPath, 'utf8'), '', 'no sudo/setfacl call should happen on a non-Linux platform');

// ── Case 2: Linux, worker user known -> grants ACL + sets default ACL ─────
const linuxResult = ensureCertReadableByGatewayWorker('netget.site', { platform: 'linux', workerUser: 'www-data' });
assert.equal(linuxResult.ok, true, linuxResult.message);
assert.match(linuxResult.message, /www-data/);

// The fake `sudo` execs the fake `setfacl` in-process, so each spawnSync
// from ensureCertReadableByGatewayWorker() logs twice (once as the "sudo …"
// wrapper call, once as the inner "setfacl …" it execs) — only count the
// outer sudo invocations to know how many spawnSync calls were actually made.
const log = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l.startsWith('sudo '));
assert.equal(log.length, 2, `expected exactly 2 sudo invocations (grant + default ACL), got: ${log.join(' | ')}`);

// First call: recursive grant on both live and archive dirs.
assert.match(log[0], /^sudo setfacl -R -m u:www-data:rX /);
assert.match(log[0], /le-live[/\\]netget\.site/);
assert.match(log[0], /le-archive[/\\]netget\.site/);

// Second call: default ACL on the archive dir only, so future renewals
// (which write new numbered files there) inherit read access automatically.
assert.match(log[1], /^sudo setfacl -d -m u:www-data:rX /);
assert.match(log[1], /le-archive[/\\]netget\.site/);
assert.doesNotMatch(log[1], /le-live/);

// ── Case 3: Linux, worker user cannot be determined -> fails loudly, no crash ─
fs.writeFileSync(logPath, '');
const unknownUserResult = ensureCertReadableByGatewayWorker('netget.site', { platform: 'linux', workerUser: null });
assert.equal(unknownUserResult.ok, false);
assert.match(unknownUserResult.message, /worker user/i);
assert.equal(fs.readFileSync(logPath, 'utf8'), '', 'must not call setfacl when the worker user is unknown');

// ── Case 4: setfacl itself fails (e.g. `acl` package not installed) ───────
fs.writeFileSync(logPath, '');
process.env.NETGET_TEST_SETFACL_EXIT = '1';
const failResult = ensureCertReadableByGatewayWorker('netget.site', { platform: 'linux', workerUser: 'www-data' });
assert.equal(failResult.ok, false);
assert.match(failResult.message, /setfacl failed/i);
delete process.env.NETGET_TEST_SETFACL_EXIT;

console.log('certbot-acl-fix ok');
