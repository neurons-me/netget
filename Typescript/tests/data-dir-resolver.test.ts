import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// One data directory, decided in one place.
//
// netget's own code writes the gateway's state (gateway-claims.json, apps.json, domain-map.json) to
// `getNetgetDataDir()` -- NETGET_DATA_DIR, else the platform's first writable default, /opt/.get on Linux.
// The local.netget routes carried their OWN `NETGET_DATA_DIR || ~/.get`, so on a Linux machine where the rest of
// netget wrote to /opt/.get they read ~/.get: a gateway whose claim had been committed still answered "unclaimed",
// and /apps read a registry that nobody writes any more. Every test that exercised those routes set
// NETGET_DATA_DIR explicitly, which is exactly the case where the two agree.
//
// This checks (1) nothing else in src decides the directory on its own, (2) the routes read the directory the
// shared resolver returns when nothing is set, and (3) an explicit NETGET_DATA_DIR is still respected.
// (On macOS/Windows the platform defaults of the two resolvers coincide, so (1) is what would catch the old
// divergence there; the Linux behaviour was also checked against a real /opt/.get.)

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../src');

// ── 1. no second resolver ────────────────────────────────────────────────────
const ALLOWED = new Map<string, string>([
  ['utils/netgetPaths.js', 'the resolver itself'],
  ['utils/localEnvironment.cli.ts', 'the read-only probe (checked below: it honors NETGET_DATA_DIR first)'],
  ['scripts/init_dirs.ts', 'creates the dev/static folders under ~/.get at install; not the runtime data directory'],
  ['netget.cli.ts', 'the legacy --sqlite-path default, an explicit /opt/.get for the old domains.db'],
]);
const pattern = /process\.env\.NETGET_DATA_DIR\s*\|\||homedir\(\)\s*,\s*['"]\.get['"]/;
const found: string[] = [];
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs|ts)$/.test(entry.name)) continue;
    const rel = path.relative(srcDir, full).split(path.sep).join('/');
    if (ALLOWED.has(rel)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment describing the old behaviour is not a resolver
      if (pattern.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
};
walk(srcDir);
assert.deepEqual(found, [], `something other than utils/netgetPaths.js decides the data directory:\n  ${found.join('\n  ')}`);

// ── 2 & 3. the routes read the resolver's directory, and honor an explicit one ─
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-datadir-'));
process.env.HOME = path.join(tmp, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.NETGET_DATA_DIR;
process.env.NETGET_MONAD_NAMESPACE = 'datadir-test.me';
process.env.NETGET_MAIN_SERVER_RECONCILE_MS = '0';
delete process.env.NETGET_MONAD_ORIGIN;

const { getNetgetDataDir } = await import('../src/utils/netgetPaths.js');
const { getProbableDataDir } = await import('../src/utils/localEnvironment.cli.ts');
const express: any = createRequire(path.join(here, '../src/htmls/Netget-REACT/backend/routes/localNetget.js'))('express');
const router: any = (await import('../src/htmls/Netget-REACT/backend/routes/localNetget.js')).default;

const app = express();
app.use('/', router);
const server: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = (server.address() as any).port;
const get = (p: string): Promise<any> => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve(JSON.parse(text))); }).on('error', reject);
});
const OWNER_A = 'a'.repeat(64); const OWNER_B = 'b'.repeat(64);
const write = (dir: string, owner: string, appName: string) => {
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime', 'gateway-claims.json'), JSON.stringify({ gatewayId: `gw-${owner[0]}`, owner, admins: { [owner]: true }, grants: { [owner]: [] }, version: 'v', updatedAt: 1 }));
  fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: { [appName]: { name: appName, port: 1, lastSeenMs: Date.now(), ttlMs: 60000 } } }));
};

try {
  // nothing set: the routes read exactly the directory the shared resolver returns
  const chosen = getNetgetDataDir();
  assert.ok(chosen && chosen !== process.env.NETGET_DATA_DIR);
  write(chosen, OWNER_A, 'from-the-resolved-dir');
  const identity = await get('/gateway-identity');
  assert.equal(identity.owner, OWNER_A, 'the claim written where the rest of netget writes is the claim the route reports');
  assert.equal(identity.bootstrapped, true);
  assert.equal(identity.adminCount, 1);
  assert.equal(identity.gatewayId, `gw-${OWNER_A[0]}`, 'and it is not the hostname fallback of "no claim found"');
  const apps = await get('/apps');
  assert.deepEqual((apps.apps ?? []).map((a: any) => a.name), ['from-the-resolved-dir'], '/apps reads the registry that is actually written');
  assert.equal(getProbableDataDir(), fs.existsSync('/opt/.get') && os.platform() === 'linux' ? '/opt/.get' : path.join(process.env.HOME!, '.get'));

  // an explicit NETGET_DATA_DIR wins, in the routes and in the probe
  const explicit = path.join(tmp, 'explicit-dir');
  write(explicit, OWNER_B, 'from-the-explicit-dir');
  process.env.NETGET_DATA_DIR = explicit;
  assert.equal(getNetgetDataDir(), explicit);
  assert.equal(getProbableDataDir(), explicit);
  const explicitIdentity = await get('/gateway-identity');
  assert.equal(explicitIdentity.owner, OWNER_B, 'an explicit setting is still respected');
  assert.deepEqual(((await get('/apps')).apps ?? []).map((a: any) => a.name), ['from-the-explicit-dir']);

  // and unsetting it goes back to the resolver's directory
  delete process.env.NETGET_DATA_DIR;
  assert.equal((await get('/gateway-identity')).owner, OWNER_A);
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('data-dir-resolver.test.ts: all assertions passed');
process.exit(0);
