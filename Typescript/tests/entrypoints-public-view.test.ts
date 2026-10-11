import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// /entrypoints: the doors into this netget. Names that only mean something on this machine are listed to a peer that
// is on it, never to the internet; the retired local.netget alias is not listed at all; the public main server is.
const resty = ['/usr/local/openresty/bin/resty', '/opt/homebrew/bin/resty', '/usr/local/bin/resty'].find((p) => fs.existsSync(p));
if (!resty) {
  console.log('entrypoints-public-view: skipped (no resty on this machine; run on the gateway host)');
} else {
  const harness = path.resolve('tests/lua/entrypoints_harness.lua');
  const handler = path.resolve('src/modules/NetGetX/OpenResty/lua/handlers/surface_resolution.lua');
  const run = (remote: string, main = '') => {
    const out = spawnSync(resty, [harness, remote, handler, main], { env: { ...process.env, NETGET_DATA_DIR: '/tmp' }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    return (JSON.parse(out.stdout.trim().split('\n').pop() as string).entrypoints as any[]).map((e) => e.host);
  };
  assert.deepEqual(run('203.0.113.7', 'netget.site'), ['netget.site'], 'a peer from the internet sees the public door only');
  assert.deepEqual(run('203.0.113.7'), [], 'and nothing when no main server is configured');
  assert.deepEqual(run('127.0.0.1', 'netget.site'), ['localhost', '127.0.0.1', 'netget.site'], 'a process on the machine also sees the local names');
  assert.deepEqual(run('10.128.0.99', 'netget.site'), ['localhost', '127.0.0.1', 'netget.site'], 'and so does a peer on its LAN');
  for (const remote of ['203.0.113.7', '127.0.0.1', '10.0.0.4']) assert.ok(!run(remote, 'netget.site').includes('local.netget'), `local.netget is retired (${remote})`);
  console.log('entrypoints-public-view: ok');
}
