import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// `netget setup-code`: opens a setup session and prints the code, changing nothing
// else -- the code the browser claim asks for, that `netget init` also creates but
// with a lot more around it. Disposable data dir; the CLI runs as a real process.

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../src/netget.cli.ts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-setup-code-'));
fs.mkdirSync(path.join(tmp, 'runtime'), { recursive: true });
const env = { ...process.env, NETGET_DATA_DIR: tmp };
delete (env as any).NETGET_GATEWAY_SEED;

const before = fs.readdirSync(tmp).sort();
const { stdout } = await exec(process.execPath, ['--import', 'tsx', '--no-warnings', cli, 'setup-code', '--json'], { env, cwd: path.resolve(here, '..') });
const out = JSON.parse(stdout.trim().split('\n').pop()!);
assert.equal(out.ok, true);
assert.match(out.code, /^[A-Za-z0-9-]{6,}$/);
assert.ok(out.expiresAt > Date.now());

// what it created: the setup session (and, on a fresh gateway, its own identity file) -- no nginx, no monad, no domains
const created = fs.readdirSync(tmp, { recursive: true }).map(String).filter((f) => !before.includes(f));
assert.ok(created.some((f) => /setup/i.test(f)), `a setup session was written: ${created.join(', ')}`);
assert.ok(!created.some((f) => /nginx|domain|apps\.json|\.conf$/i.test(f)), `nothing else was touched: ${created.join(', ')}`);

// and it is the code the gateway's own routes accept
process.env.NETGET_DATA_DIR = tmp;
const { verifySetupCode } = await import('../src/modules/NetGetX/Auth/gatewaySetupSession.ts');
assert.equal(verifySetupCode('definitely-not-the-code').ok, false);
assert.equal(verifySetupCode(out.code).ok, true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('netget-setup-code.test.ts: all assertions passed');
process.exit(0);
