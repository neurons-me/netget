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

// Both sit alongside the existing /domains block, not inside it — the
// existing domain CRUD locations must be untouched by this slice.
assert.match(conf, /location = \/entrypoints[\s\S]*location = \/surfaces[\s\S]*location \/domains \{/);

console.log('surface-resolution-routes ok');
