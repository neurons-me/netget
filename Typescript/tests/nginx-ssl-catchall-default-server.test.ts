import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Real production bug, root-caused live on netget.site: the port-443
// catch-all server block (server_name _;, the one with
// ssl_certificate_by_lua_block that picks a cert per-domain from the
// domain-map) had no `default_server` flag. Without it, nginx falls back to
// whichever `listen 443 ssl;` block was defined FIRST in file/include
// order to serve unmatched SNI — which was netget_app.conf's `netget.local`
// block (a *static* self-signed cert), included before this one. Every
// custom domain not literally named `netget.local` silently got the
// self-signed fallback cert, regardless of whether its real Let's Encrypt
// cert was valid on disk. The port-80 catch-all already had this flag
// (line above it in the source) — 443 was the one missing it.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const conf = buildNginxConfigContent();

assert.match(
    conf,
    /listen 443 ssl default_server;\s*\n\s*listen \[::\]:443 ssl default_server;\s*\n\s*server_name _;/,
    'the dynamic per-domain SSL catch-all (server_name _;) must be default_server on both listeners, or an earlier-loaded static-cert server block silently wins for every unmatched hostname',
);

console.log('nginx-ssl-catchall-default-server ok');
