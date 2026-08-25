import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Coverage for the `netget frontend-mode` command's core roundtrip: saving a
// mode must actually change what getNetgetAppConfContent() (netget_app.conf's
// generator) produces on the very next call — this was previously only ever
// exercised by hand, by running the interactive Main Server menu and staring
// at the generated file. The command exists because switching modes had no
// non-interactive path at all: someone had to SSH in, edit xConfig.json by
// hand, then find and run the right menu option to regenerate+reload.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-frontendmode-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const { saveMainServerFrontendConfig, resolveMainServerFrontendConfig } =
    await import('../src/modules/NetGetX/OpenResty/mainServerFrontend.ts');
const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

// ── dev mode: generated config proxies live to the dev server ─────────────
await saveMainServerFrontendConfig({ mode: 'dev', devUrl: 'http://127.0.0.1:5173' });
assert.equal(resolveMainServerFrontendConfig().mode, 'dev');
const devConf = getNetgetAppConfContent();
assert.match(devConf, /proxy_pass http:\/\/127\.0\.0\.1:5173;/, 'dev mode must proxy_pass to the configured dev server');

// ── local-dist mode: generated config serves the static build, no dev proxy ─
await saveMainServerFrontendConfig({ mode: 'local-dist' });
assert.equal(resolveMainServerFrontendConfig().mode, 'local-dist');
const localDistConf = getNetgetAppConfContent();
assert.doesNotMatch(localDistConf, /proxy_pass http:\/\/127\.0\.0\.1:5173;/, 'local-dist mode must not proxy to the dev server');

// ── package-dist mode: same, no dev proxy ──────────────────────────────────
await saveMainServerFrontendConfig({ mode: 'package-dist' });
assert.equal(resolveMainServerFrontendConfig().mode, 'package-dist');
const packageDistConf = getNetgetAppConfContent();
assert.doesNotMatch(packageDistConf, /proxy_pass http:\/\/127\.0\.0\.1:5173;/, 'package-dist mode must not proxy to the dev server');

console.log('frontend-mode-switch ok');
