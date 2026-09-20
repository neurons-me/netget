import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `netget gateway-adopt <monad>`: records that an existing monad mounts the
// gateway and where nginx should send the gateway's API. Disposable: a temp
// MONADS_HOME with a fake record, a temp NETGET_DATA_DIR.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-gateway-adopt-'));
const monadsHome = path.join(tmp, 'monads');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
process.env.MONADS_HOME = monadsHome;
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_GATEWAY_SEED = 'a'.repeat(64);

function fakeMonad(name: string, namespace: string, port: number) {
  const dir = path.join(monadsHome, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'monad.json'), JSON.stringify({
    name, identity: namespace, namespace, surface: name, port, pid: 0,
    endpoint: `http://127.0.0.1:${port}`, cwd: tmp, startedAt: '', updatedAt: '', status: 'stopped',
    runtimeDir: dir, stateDir: path.join(dir, 'state'), claimDir: path.join(dir, 'claims'),
    selfConfigPath: path.join(dir, 'self.json'), stdoutLog: '', stderrLog: '',
  }));
}

const { adoptMonadAsGateway, mergeModules, GATEWAY_MODULE } = await import('../src/gateway/adopt.ts');
const { readMonadEnv } = await import('monad.ai');

assert.equal(mergeModules(undefined, GATEWAY_MODULE), 'netget/gateway');
assert.equal(mergeModules('a, b', GATEWAY_MODULE), 'a,b,netget/gateway');
assert.equal(mergeModules('netget/gateway,a', GATEWAY_MODULE), 'netget/gateway,a', 'not added twice');

await assert.rejects(() => adoptMonadAsGateway({ monad: 'nobody' }), /No monad named "nobody"/);

fakeMonad('local', 'netget.site', 8161);
const first = await adoptMonadAsGateway({ monad: 'local' });
assert.equal(first.namespace, 'netget.site');
assert.equal(first.gatewayUpstream, 'http://127.0.0.1:8161');
assert.equal(first.seedChanged, false);

// what the monad will start with: the module and who it is; NOT a seed
let env = readMonadEnv('local');
assert.equal(env.MONAD_MODULES, 'netget/gateway');
assert.equal(env.NETGET_MONAD_NAME, 'local');
assert.equal(env.NETGET_MONAD_NAMESPACE, 'netget.site');
assert.equal(env.SEED, undefined, 'a monad keeps its seed unless asked to change it');
assert.ok(!JSON.stringify(first).includes('a'.repeat(64)));

// where nginx sends the gateway's API
const xConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'xConfig.json'), 'utf8'));
assert.equal(xConfig.gatewayUpstream, 'http://127.0.0.1:8161');

// idempotent; a front end can be added; the seed changes only on request
const second = await adoptMonadAsGateway({ monad: 'local', frontendDir: '/srv/ui/dist', useGatewaySeed: true });
env = readMonadEnv('local');
assert.equal(env.MONAD_MODULES, 'netget/gateway');
assert.equal(env.MONAD_FRONTEND_DIR, '/srv/ui/dist');
assert.equal(env.SEED, 'a'.repeat(64));
assert.equal(second.seedChanged, true);
assert.ok(second.stored.includes('SEED'));
assert.ok(!JSON.stringify(second).includes('a'.repeat(64)), 'the seed is never returned');
assert.equal(fs.statSync(path.join(monadsHome, 'local', 'env.json')).mode & 0o777, 0o600);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('gateway-adopt.test.ts: all assertions passed');
process.exit(0);
