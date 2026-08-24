import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Slice 2: verifies getNetgetAppConfContent() wires /entrypoints and
// /surfaces next to /domains, /apps, /gateway-identity — read-only, no
// domain-publish/write action, no monad, no .me kernel involvement (see
// src/types/SurfaceResolution.ts and lua/handlers/surface_resolution.lua).

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });

process.env.NETGET_DATA_DIR = tmpDataDir;
const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

const conf = getNetgetAppConfContent();

function locationBlock(marker: string): string {
  const start = conf.indexOf(marker);
  assert.notEqual(start, -1, `missing location marker: ${marker}`);
  const rest = conf.slice(start);
  const end = rest.indexOf('\n    }\n');
  assert.notEqual(end, -1, `missing location end for: ${marker}`);
  return rest.slice(0, end + '\n    }\n'.length);
}

// Both routes exist, dispatch through the dedicated handler with the
// expected $surface_resolution_action, and are read-only (GET/OPTIONS only,
// no write verbs allowed like /domains' CRUD locations get).
assert.match(conf, /location = \/entrypoints \{[\s\S]*?set \$surface_resolution_action entrypoints;[\s\S]*?content_by_lua_file lua\/handlers\/surface_resolution\.lua;[\s\S]*?\}/);
assert.match(conf, /location = \/surfaces \{[\s\S]*?set \$surface_resolution_action surfaces;[\s\S]*?content_by_lua_file lua\/handlers\/surface_resolution\.lua;[\s\S]*?\}/);

const entrypointsBlock = conf.match(/location = \/entrypoints \{[\s\S]*?\n {4}\}/)?.[0] ?? '';
const surfacesBlock = conf.match(/location = \/surfaces \{[\s\S]*?\n {4}\}/)?.[0] ?? '';
assert.match(entrypointsBlock, /Allow-Methods' 'GET, OPTIONS'/);
assert.match(surfacesBlock, /Allow-Methods' 'GET, OPTIONS'/);
assert.doesNotMatch(entrypointsBlock, /POST|PUT|DELETE/);
assert.doesNotMatch(surfacesBlock, /POST|PUT|DELETE/);

// openresty.lua shells out to the netget CLI from inside the exact control
// locations below. A server-level `set` is not reliable enough for Lua access
// here, so keep the concrete bin path in the location itself.
for (const route of ['openresty-status', 'openresty-restart', 'openresty-stop']) {
  const block = conf.match(new RegExp(`location = /${route} \\{[\\s\\S]*?\\n {4}\\}`))?.[0] ?? '';
  assert.match(block, /set \$NETGET_CLI_BIN "/);
}

// Both sit alongside the existing /domains block, not inside it — the
// existing domain CRUD locations must be untouched by this slice.
assert.match(conf, /location = \/entrypoints[\s\S]*location = \/surfaces[\s\S]*location \/domains \{/);

// Domain/cert routes are API endpoints. Since the Domain Store Split-Brain
// fix they proxy_pass straight to the daemon (localNetget.js, kernel-backed
// domainStore.ts) — domains.lua no longer exists — but must still never fall
// back to the React SPA, otherwise callers get `<!DOCTYPE...` and JSON
// parsing fails in the dashboard.
for (const [marker, path] of [
  ['location /domains {', '/domains'],
  ['location ~ ^/domains/([^/]+)/subdomains$ {', ''],
  ['location /add-domain {', '/add-domain'],
  ['location /update-domain {', '/update-domain'],
  ['location /delete-domain {', '/delete-domain'],
  ['location /provision-cert {', '/provision-cert'],
] as const) {
  const block = locationBlock(marker);
  assert.match(block, new RegExp(`proxy_pass http://127\\.0\\.0\\.1:3000${path.replace(/\//g, '\\/')};`));
  assert.doesNotMatch(block, /content_by_lua_file lua\/handlers\/domains\.lua/);
  assert.doesNotMatch(block, /try_files/);
}

const handler = fs.readFileSync(
  path.join(process.cwd(), 'src/modules/NetGetX/OpenResty/lua/handlers/surface_resolution.lua'),
  'utf8'
);

// sqlite NULLs decode through cjson as userdata (`cjson.null`), not nil, so
// the Lua handler must normalize optional string fields before concatenating.
assert.match(handler, /local function optional_string/);
assert.match(handler, /optional_string\(row\.subdomain\)/);
assert.match(handler, /optional_string\(row\.sslMode\)/);
assert.match(handler, /local function is_control_entrypoint/);

console.log('surface-resolution-routes ok');
