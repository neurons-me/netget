import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers syncMainServerFrontendToHtmlRoot() — makes ${xConfig}/html/index.html
// (the entry point nginx.conf's plain-HTTP location / Lua handler serves
// directly for local.netget/localhost/127.0.0.1) a real, netget-owned index
// instead of a dead path nothing ever populated.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const {
    syncMainServerFrontendToHtmlRoot,
    saveMainServerFrontendConfig,
    getLocalMainServerUiDistDir,
} = await import('../src/modules/NetGetX/OpenResty/mainServerFrontend.ts');

const htmlRoot = path.join(tmpDataDir, 'html');

// ── Default mode (package-dist): copies the real bundled panel build ──────
const defaultResult = syncMainServerFrontendToHtmlRoot();
assert.equal(defaultResult.copied, true, defaultResult.reason);
assert.ok(fs.existsSync(path.join(htmlRoot, 'index.html')), '${xConfig}/html/index.html must exist after sync');

// ── Calling again with nothing changed: no redundant copy ─────────────────
const secondResult = syncMainServerFrontendToHtmlRoot();
assert.equal(secondResult.copied, false);
assert.match(secondResult.reason || '', /up to date/);

// ── dev mode: proxies live, nothing to copy ────────────────────────────────
await saveMainServerFrontendConfig({ mode: 'dev', devUrl: 'http://127.0.0.1:5173' });
const devResult = syncMainServerFrontendToHtmlRoot();
assert.equal(devResult.copied, false);
assert.match(devResult.reason || '', /dev mode/);

// ── local-dist mode with nothing built yet: reports why, doesn't crash ────
await saveMainServerFrontendConfig({ mode: 'local-dist' });
assert.equal(fs.existsSync(path.join(getLocalMainServerUiDistDir(), 'index.html')), false);
const missingResult = syncMainServerFrontendToHtmlRoot();
assert.equal(missingResult.copied, false);
assert.match(missingResult.reason || '', /no built index\.html/);

console.log('main-server-html-root-sync ok');
