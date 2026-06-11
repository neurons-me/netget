import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifies the wiring for state 5 (NO_LIVE_MONAD):
//   - no-monad.html exists with the expected placeholders
//   - buildNginxConfigContent() loads it and defines render_no_monad()
//   - surface_proxy.lua calls render_no_monad() for the html branch

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });
process.env.NETGET_DATA_DIR = tmpDataDir;

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const conf = buildNginxConfigContent();

assert.match(conf, /NO_MONAD_TEMPLATE_PATH = ".*no-monad\.html"/);
assert.match(conf, /_G\.NO_MONAD_TEMPLATE = read_file\(NO_MONAD_TEMPLATE_PATH\)/);
assert.match(conf, /function _G\.render_no_monad\(host, rootspace, hint, err\)/);

const noMonadHtmlPath = fileURLToPath(
  new URL('../assets/namespace-surface/no-monad.html', import.meta.url)
);
const html = fs.readFileSync(noMonadHtmlPath, 'utf8');
for (const placeholder of ['{{HOST}}', '{{ROOTSPACE}}', '{{HINT}}', '{{ERROR}}', '{{HOST_JSON}}']) {
  assert.ok(html.includes(placeholder), `no-monad.html missing ${placeholder}`);
}
assert.match(html, /this\.gui\.umd\.js/);
assert.match(html, /ns-assets\/styles\.css/);

const surfaceProxyPath = fileURLToPath(
  new URL('../src/modules/NetGetX/OpenResty/lua/handlers/surface_proxy.lua', import.meta.url)
);
const lua = fs.readFileSync(surfaceProxyPath, 'utf8');
assert.match(lua, /_G\.render_no_monad\(host, rootspace_of\(host\), hint, reason\)/);

console.log('no-live-monad.test.ts passed');
