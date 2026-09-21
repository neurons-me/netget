import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

// A response that already has a Cache-Control keeps it; only one with none is marked no-store.
//
// The blocks that proxy a namespace to its monad added `Cache-Control: no-store` to EVERY response. The monad marks the
// front end's hashed assets `immutable` (and its fixed-name files `no-cache`), so each got a second, contradictory value;
// browsers obey no-store, so the 2.4 MB script and the 5 MB icon font were downloaded again on every load -- on a slow
// connection, with `font-display: block`, the sidebar's icons simply did not appear.
//
// (1) the generated conf uses the conditional header in all three blocks and no unconditional no-store is left; (2) the
// very text the generator emits, run in a real OpenResty in front of a tiny upstream, does what it says.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-cache-control-'));
process.env.NETGET_DATA_DIR = path.join(tmp, 'data');
process.env.NETGET_LETSENCRYPT_LIVE_DIR = path.join(tmp, 'live');
fs.mkdirSync(path.join(process.env.NETGET_DATA_DIR, 'runtime'), { recursive: true });
delete process.env.NETGET_GATEWAY_UPSTREAM;
// a registered public domain with a certificate gets its own server block (the third place the header was added)
fs.mkdirSync(path.join(tmp, 'live', 'example.org'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'live', 'example.org', 'fullchain.pem'), 'fake');
fs.writeFileSync(path.join(tmp, 'live', 'example.org', 'privkey.pem'), 'fake');
fs.writeFileSync(path.join(process.env.NETGET_DATA_DIR, 'runtime', 'domain-map.json'), JSON.stringify({ version: 1, domains: { 'example.org': {} } }));

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
const conf = getNetgetAppConfContent();

// ── 1. the generated conf ────────────────────────────────────────────────────
const maps = conf.match(/map \$upstream_http_cache_control \$netget_default_cache_control \{[\s\S]*?\n    \}/g) ?? [];
assert.equal(maps.length, 1, 'the map is defined once');
assert.equal((conf.match(/add_header Cache-Control \$netget_default_cache_control always;/g) ?? []).length, 3, 'the three surface-proxy blocks use it');
assert.doesNotMatch(conf, /add_header Cache-Control "no-store" always;/, 'no unconditional no-store on a proxied response');

// ── 2. what that text does, in a real OpenResty ─────────────────────────────
const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) {
  console.log('nginx-cache-control-passthrough.test.ts: generated conf checked; the OpenResty part is skipped (no openresty on this machine)');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const upstreamPort = await freePort(); const nginxPort = await freePort();
const upstream = http.createServer((req, res) => {
  if (req.url === '/hashed') res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (req.url === '/no-cache') res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/plain');
  res.end('ok');
});
await new Promise<void>((resolve) => upstream.listen(upstreamPort, '127.0.0.1', () => resolve()));

const prefix = path.join(tmp, 'or');
for (const d of ['conf', 'logs']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), `worker_processes 1;
pid ${path.join(prefix, 'logs', 'nginx.pid')};
error_log ${path.join(prefix, 'logs', 'error.log')};
events { worker_connections 64; }
http {
    access_log off;
${maps[0]}
    server {
        listen 127.0.0.1:${nginxPort};
        location / {
            proxy_pass http://127.0.0.1:${upstreamPort};
            add_header Cache-Control $netget_default_cache_control always;
        }
    }
}
`);
execFileSync(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { stdio: 'ignore' });
const nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
const listening = () => new Promise<boolean>((r) => { const c = net.connect(nginxPort, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
for (let i = 0; i < 50 && !(await listening()); i += 1) await new Promise((r) => setTimeout(r, 100));

const cacheControlOf = (p: string): Promise<string[]> => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: nginxPort, path: p }, (res) => {
    const values: string[] = [];
    for (let i = 0; i < res.rawHeaders.length; i += 2) if (res.rawHeaders[i].toLowerCase() === 'cache-control') values.push(res.rawHeaders[i + 1]);
    res.resume(); res.on('end', () => resolve(values));
  }).on('error', reject);
});
try {
  assert.deepEqual(await cacheControlOf('/hashed'), ['public, max-age=31536000, immutable'], 'a hashed asset keeps its immutable, alone (before: immutable AND no-store)');
  assert.deepEqual(await cacheControlOf('/no-cache'), ['no-cache'], 'a file the gateway said no-cache for stays exactly that');
  assert.deepEqual(await cacheControlOf('/dynamic'), ['no-store'], 'a response with none (an NRP read) is still marked no-store');
} finally {
  nginx.kill();
  upstream.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('nginx-cache-control-passthrough.test.ts: all assertions passed');
process.exit(0);
